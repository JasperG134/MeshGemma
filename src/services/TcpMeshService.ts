import TcpSocket from 'react-native-tcp-socket';
import type { SignedEnvelope } from './CryptoService';
import type { Incident } from './MockDatabase';

export type LocationPayload = {
  lat: number;
  lng: number;
  // Sender's friendly name at the time of broadcast. Optional so peers without
  // a custom name don't bloat the payload. Receivers fall back to shortId.
  displayName?: string;
  // GPS accuracy in metres if known. Renders as a halo on the map.
  accuracy?: number;
};

export type InnerMessage =
  | { kind: 'INCIDENT'; data: Incident }
  | { kind: 'CHAT'; data: { text: string; from: string } }
  | { kind: 'PING'; data: { from: string } }
  | { kind: 'LOCATION'; data: LocationPayload }
  | { kind: 'CATCHUP'; data: { envelopes: SignedEnvelope<InnerMessage>[] } };

export type WireEnvelope = SignedEnvelope<InnerMessage>;

export type BroadcastTarget = { ip: string; port?: number };
export type BroadcastResult = { ok: BroadcastTarget[]; failed: BroadcastTarget[] };

// Listener for individual envelopes the local peer should process. Forwarded
// envelopes — already verified — are passed through here. Whoever subscribes
// is responsible for verify+dedup; this layer doesn't know crypto.
export type EnvelopeListener = (env: WireEnvelope) => void;

const DEFAULT_PORT = 4000;
const CONNECT_TIMEOUT_MS = 5000;
const MAX_BUFFER_BYTES = 1024 * 1024;
const FORWARD_SEEN_CAP = 1000;
const RECENT_BUFFER_CAP = 50;

function targetKey(ip: string, port: number): string {
  return `${ip}:${port}`;
}

// react-native-tcp-socket reports IPv4-mapped IPv6 addresses on iOS
// (`::ffff:1.2.3.4`). Strip the prefix so source-suppression compares apples
// to apples with the outbound `ip:port` keys, which are pure IPv4.
function normalizeAddr(addr: string): string {
  if (!addr) return '';
  const stripped = addr.startsWith('::ffff:') ? addr.slice('::ffff:'.length) : addr;
  return stripped.toLowerCase();
}

class TcpMeshService {
  private server: TcpSocket.Server | null = null;
  private port = DEFAULT_PORT;

  // Inbound (server-accepted) sockets.
  private activeSockets = new Set<TcpSocket.Socket>();

  // Outbound connection registry, keyed by `${ip}:${port}`.
  private outboundSockets = new Map<string, TcpSocket.Socket>();

  // Multi-listener support.
  private listeners = new Set<EnvelopeListener>();

  // Forwarding-layer dedup. Separate from the AppContext-level delivery seen
  // set: this one stops a single envelope from looping back through us, the
  // other one stops a single envelope from being delivered to the UI twice.
  private seenForwarded = new Set<string>();
  private seenForwardedOrder: string[] = [];

  // Replay/catchup ring buffer of envelopes we've sent (filled by integrator).
  private recentEnvelopes: WireEnvelope[] = [];

  /** Start the inbound TCP server. Idempotent and safe across listen errors. */
  startServer(port?: number): void {
    if (this.server) {
      return;
    }
    if (typeof port === 'number') {
      this.port = port;
    }

    let server: TcpSocket.Server;
    try {
      server = TcpSocket.createServer((socket) => this.handleInboundSocket(socket));
    } catch (err) {
      console.warn('[TcpMeshService] createServer threw:', err);
      this.server = null;
      return;
    }

    // Wire error handler before listen so listen-time errors don't escape.
    server.on('error', (error) => {
      console.warn('[TcpMeshService] server error:', error);
      // Tear down so a subsequent startServer can retry cleanly.
      try {
        server.close();
      } catch {
        // best-effort
      }
      if (this.server === server) {
        this.server = null;
      }
    });

    this.server = server;

    try {
      server.listen({ port: this.port, host: '0.0.0.0' }, () => {});
    } catch (err) {
      console.warn('[TcpMeshService] listen threw:', err);
      try {
        server.close();
      } catch {
        // best-effort
      }
      this.server = null;
    }
  }

  /** Close the server and tear down all sockets in both directions. Idempotent. */
  stopServer(): void {
    this.activeSockets.forEach((s) => {
      try {
        s.destroy();
      } catch {
        // best-effort
      }
    });
    this.activeSockets.clear();

    this.outboundSockets.forEach((s) => {
      try {
        s.destroy();
      } catch {
        // best-effort
      }
    });
    this.outboundSockets.clear();

    if (this.server) {
      try {
        this.server.close();
      } catch (err) {
        console.warn('[TcpMeshService] error closing server:', err);
      }
      this.server = null;
    }
  }

  /** Subscribe to received envelopes. Returns unsubscribe fn. */
  subscribe(listener: EnvelopeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getPort(): number {
    return this.port;
  }

  /**
   * Send a single envelope to one peer. Reuses an open outbound socket for
   * the same target if available; otherwise opens a new one and keeps it.
   */
  sendTo(target: BroadcastTarget, env: WireEnvelope): Promise<void> {
    const port = target.port ?? this.port;
    const key = targetKey(target.ip, port);
    const data = JSON.stringify(env) + '\n';

    // Try reusing an existing healthy socket.
    const existing = this.outboundSockets.get(key);
    if (existing && !existing.destroyed) {
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (err?: Error) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };
        try {
          existing.write(data, 'utf8', (err) => {
            if (err) {
              // Drop this socket so the next call opens a fresh one.
              this.evictOutbound(key, existing);
              done(err instanceof Error ? err : new Error(String(err)));
              return;
            }
            done();
          });
        } catch (err) {
          this.evictOutbound(key, existing);
          done(err instanceof Error ? err : new Error(String(err)));
        }
      });
    }

    // Open a fresh socket; keep it after the send.
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (err) reject(err);
        else resolve();
      };

      let client: TcpSocket.Socket | null = null;

      timeoutTimer = setTimeout(() => {
        if (settled) return;
        if (client) {
          try {
            client.destroy();
          } catch {
            // best-effort
          }
        }
        done(new Error(`Connection to ${key} timed out`));
      }, CONNECT_TIMEOUT_MS);

      try {
        client = TcpSocket.createConnection({ port, host: target.ip }, () => {
          if (settled || !client) return;
          try {
            client.write(data, 'utf8', (writeErr) => {
              if (writeErr) {
                if (client) {
                  this.evictOutbound(key, client);
                }
                done(writeErr instanceof Error ? writeErr : new Error(String(writeErr)));
                return;
              }
              done();
            });
          } catch (err) {
            if (client) {
              this.evictOutbound(key, client);
            }
            done(err instanceof Error ? err : new Error(String(err)));
          }
        });
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const sock = client;
      if (!sock) {
        done(new Error('Failed to create connection'));
        return;
      }

      // Record immediately so concurrent sends to the same target queue up
      // on a single pending socket. If the socket fails to connect, the
      // 'close'/'error' handlers will evict it.
      this.outboundSockets.set(key, sock);

      sock.on('error', (error) => {
        this.evictOutbound(key, sock);
        // Past resolved sends are unaffected; only signal failure if not yet
        // settled.
        done(error instanceof Error ? error : new Error(String(error)));
      });

      sock.on('close', () => {
        this.evictOutbound(key, sock);
        if (!settled) {
          // Closed before we could send.
          done(new Error(`Connection to ${key} closed before send completed`));
        }
      });
    });
  }

  /** Send to many peers in parallel. Returns ok/failed split. */
  async broadcast(env: WireEnvelope, targets: BroadcastTarget[]): Promise<BroadcastResult> {
    const settled = await Promise.allSettled(targets.map((t) => this.sendTo(t, env)));
    const ok: BroadcastTarget[] = [];
    const failed: BroadcastTarget[] = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') ok.push(targets[i]);
      else failed.push(targets[i]);
    });
    return { ok, failed };
  }

  /** Append an envelope to the bounded recent-outgoing buffer. */
  rememberOutgoing(env: WireEnvelope): void {
    this.recentEnvelopes.push(env);
    if (this.recentEnvelopes.length > RECENT_BUFFER_CAP) {
      this.recentEnvelopes.splice(0, this.recentEnvelopes.length - RECENT_BUFFER_CAP);
    }

    // Pre-populate the forwarding-seen set so a peer's bounce-back of our own
    // envelope doesn't re-trigger our forward path. Without this, A → B → A
    // amplifies the wire by re-forwarding to all of A's other peers.
    if (env && typeof env.pubKey === 'string' && typeof env.lamport === 'number') {
      const key = `${env.pubKey}:${env.lamport}`;
      if (!this.seenForwarded.has(key)) {
        this.seenForwarded.add(key);
        this.seenForwardedOrder.push(key);
        if (this.seenForwardedOrder.length > FORWARD_SEEN_CAP) {
          const drop = this.seenForwardedOrder.shift();
          if (drop !== undefined) this.seenForwarded.delete(drop);
        }
      }
    }
  }

  /** Snapshot of the most recent up-to-`limit` outgoing envelopes. */
  getRecent(limit: number = RECENT_BUFFER_CAP): WireEnvelope[] {
    if (limit <= 0) return [];
    const start = Math.max(0, this.recentEnvelopes.length - limit);
    return this.recentEnvelopes.slice(start);
  }

  /** Send a CATCHUP (or any) envelope to a freshly-discovered peer. */
  sendCatchup(target: BroadcastTarget, env: WireEnvelope): Promise<void> {
    return this.sendTo(target, env);
  }

  // ---- internal helpers ----

  private handleInboundSocket(socket: TcpSocket.Socket): void {
    const remoteAddress = socket.remoteAddress ?? '';
    this.activeSockets.add(socket);

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString('utf8');

      if (buffer.length > MAX_BUFFER_BYTES) {
        // Don't kill the connection — just drop the malformed/oversized buffer
        // and keep the socket open for future framing.
        console.warn(
          `[TcpMeshService] inbound buffer exceeded ${MAX_BUFFER_BYTES} bytes from ${remoteAddress}; dropping buffer`,
        );
        buffer = '';
        return;
      }

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const messageStr = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (!messageStr.trim()) continue;

        let envelope: WireEnvelope;
        try {
          envelope = JSON.parse(messageStr) as WireEnvelope;
        } catch (e) {
          console.error('[TcpMeshService] failed to parse incoming TCP message:', e);
          continue;
        }
        this.handleEnvelope(envelope, remoteAddress);
      }
    });

    socket.on('error', (error) => {
      console.warn('[TcpMeshService] inbound socket error:', error);
      this.activeSockets.delete(socket);
      try {
        socket.destroy();
      } catch {
        // best-effort
      }
    });

    socket.on('close', () => {
      this.activeSockets.delete(socket);
    });
  }

  private handleEnvelope(env: WireEnvelope, sourceAddress: string): void {
    // Deliver to every subscriber, isolated from each other.
    this.listeners.forEach((l) => {
      try {
        l(env);
      } catch (err) {
        console.warn('[TcpMeshService] listener threw:', err);
      }
    });

    // Forwarding policy. Don't forward CATCHUP — those are bulk replays
    // intended for a single recipient. Don't forward malformed envelopes
    // (defensive — the verify happens upstream).
    if (!env || !env.payload || env.payload.kind === 'CATCHUP') {
      return;
    }
    if (typeof env.pubKey !== 'string' || typeof env.lamport !== 'number') {
      return;
    }

    const fwdKey = `${env.pubKey}:${env.lamport}`;
    if (this.seenForwarded.has(fwdKey)) {
      return;
    }
    this.seenForwarded.add(fwdKey);
    this.seenForwardedOrder.push(fwdKey);
    if (this.seenForwardedOrder.length > FORWARD_SEEN_CAP) {
      const drop = this.seenForwardedOrder.shift();
      if (drop !== undefined) this.seenForwarded.delete(drop);
    }

    // Forward to all outbound AND inbound peers, skipping the source. The
    // dedup set above absorbs any loop that slips past the source filter.
    const data = JSON.stringify(env) + '\n';
    const normalizedSource = normalizeAddr(sourceAddress);

    this.outboundSockets.forEach((sock, key) => {
      if (sock.destroyed) {
        this.outboundSockets.delete(key);
        return;
      }
      // Outbound key is `ip:port`; compare just the ip part.
      const ip = key.split(':')[0] ?? '';
      if (normalizedSource && normalizeAddr(ip) === normalizedSource) {
        return;
      }
      try {
        sock.write(data, 'utf8', (err) => {
          if (err) {
            console.warn(`[TcpMeshService] forward write error to ${key}:`, err);
            this.evictOutbound(key, sock);
          }
        });
      } catch (err) {
        console.warn(`[TcpMeshService] forward write threw for ${key}:`, err);
        this.evictOutbound(key, sock);
      }
    });

    this.activeSockets.forEach((sock) => {
      if (sock.destroyed) {
        this.activeSockets.delete(sock);
        return;
      }
      const sockAddr = normalizeAddr(sock.remoteAddress ?? '');
      if (normalizedSource && sockAddr === normalizedSource) {
        return;
      }
      try {
        sock.write(data, 'utf8', (err) => {
          if (err) {
            console.warn('[TcpMeshService] forward write error to inbound peer:', err);
            try { sock.destroy(); } catch { /* best-effort */ }
            this.activeSockets.delete(sock);
          }
        });
      } catch (err) {
        console.warn('[TcpMeshService] forward write threw for inbound peer:', err);
        try { sock.destroy(); } catch { /* best-effort */ }
        this.activeSockets.delete(sock);
      }
    });
  }

  private evictOutbound(key: string, sock: TcpSocket.Socket): void {
    const current = this.outboundSockets.get(key);
    if (current === sock) {
      this.outboundSockets.delete(key);
    }
    try {
      sock.destroy();
    } catch {
      // best-effort
    }
  }
}

export const tcpMeshService = new TcpMeshService();
export type { TcpMeshService };
