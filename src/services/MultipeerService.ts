import naclUtil from 'tweetnacl-util';
import { meshMultipeer } from 'mesh-multipeer';
import type { WireEnvelope } from './TcpMeshService';

// MPC service type: 1-15 lowercase chars + hyphens. Must match Bonjour
// entries in app.json (`_meshgemma-mc._tcp` / `_udp`).
const MPC_SERVICE_TYPE = 'meshgemma-mc';

export type MultipeerListener = (env: WireEnvelope) => void;

// Cap on the forwarding-dedup set so it can't grow unbounded on a long-lived
// session. Mirrors TcpMeshService.FORWARD_SEEN_CAP.
const FORWARD_SEEN_CAP = 1000;

class MultipeerService {
  private listeners = new Set<MultipeerListener>();
  private subs: Array<() => void> = [];
  private started = false;

  // Forwarding-layer dedup. Separate from the AppContext-level delivery `seen`
  // set: this one stops a single envelope from being re-broadcast (and thus
  // looping) more than once over MPC. The AppContext set stops a single
  // envelope from being delivered to the UI twice. Mirrors the
  // `seenForwarded` pair in TcpMeshService.
  private seenForwarded = new Set<string>();
  private seenForwardedOrder: string[] = [];

  isAvailable(): boolean {
    return meshMultipeer.isAvailable();
  }

  async start(opts: { myPubKey: string; myShortId: string }): Promise<void> {
    if (!meshMultipeer.isAvailable()) return;
    if (this.started) return;

    // displayName must be unique enough to disambiguate; the 8-char shortId
    // is enough in practice and short enough for MPC's 63-char limit.
    const displayName = `MG-${opts.myShortId}`;
    try {
      await meshMultipeer.start({
        serviceType: MPC_SERVICE_TYPE,
        displayName,
        discoveryInfo: {
          pubKey: opts.myPubKey,
          shortId: opts.myShortId,
        },
      });
      this.started = true;
    } catch (e) {
      console.warn('[MultipeerService] start failed:', e);
      return;
    }

    this.subs.push(
      meshMultipeer.addListener('onDataReceived', (e) => {
        let envelope: WireEnvelope;
        try {
          const json = naclUtil.encodeUTF8(naclUtil.decodeBase64(e.payloadBase64));
          envelope = JSON.parse(json) as WireEnvelope;
        } catch (err) {
          console.warn('[MultipeerService] parse failed for incoming MPC payload:', err);
          return;
        }
        // Deliver to every subscriber first (verify + cross-transport dedup
        // happens upstream in AppContext.handleInbound).
        this.listeners.forEach((l) => {
          try {
            l(envelope);
          } catch (err) {
            console.warn('[MultipeerService] listener threw:', err);
          }
        });
        // Then relay so the envelope hops across a multi-hop MPC chain. The
        // source peer's display name (`e.from`) lets us skip echoing it
        // straight back. Mirrors TcpMeshService.handleEnvelope.
        this.forwardEnvelope(envelope, e.from);
      }),
    );

    this.subs.push(
      meshMultipeer.addListener('onStateChange', (e) => {
        if (e.state === 'error') {
          console.warn('[MultipeerService] state=error', e.message);
        }
      }),
    );
  }

  async stop(): Promise<void> {
    this.subs.forEach((unsub) => {
      try {
        unsub();
      } catch {
        // best-effort
      }
    });
    this.subs = [];
    this.started = false;
    this.seenForwarded.clear();
    this.seenForwardedOrder = [];
    if (meshMultipeer.isAvailable()) {
      try {
        await meshMultipeer.stop();
      } catch (e) {
        console.warn('[MultipeerService] stop failed:', e);
      }
    }
  }

  subscribe(listener: MultipeerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Broadcast an envelope to all currently-connected MPC peers. Returns true
   * if at least one peer was reached, false otherwise (or if MPC is inert).
   */
  async broadcast(envelope: WireEnvelope): Promise<boolean> {
    return this.sendInternal(envelope, undefined);
  }

  /** Send to specific peer display names (e.g. for targeted catchup). */
  async sendTo(envelope: WireEnvelope, peerNames: string[]): Promise<boolean> {
    if (peerNames.length === 0) return false;
    return this.sendInternal(envelope, peerNames);
  }

  /** Subscribe to peer state changes (so catchup can fire on new 'connected'). */
  onPeerStateChange(handler: (e: { name: string; state: 'connecting' | 'connected' | 'notConnected' }) => void): () => void {
    if (!meshMultipeer.isAvailable()) return () => { /* no-op */ };
    return meshMultipeer.addListener('onPeerStateChange', handler);
  }

  private async sendInternal(envelope: WireEnvelope, peerNames?: string[]): Promise<boolean> {
    if (!meshMultipeer.isAvailable() || !this.started) return false;
    let payloadB64: string;
    try {
      // INVARIANT: JSON.stringify always returns ASCII (non-ASCII codepoints
      // are escaped as \uXXXX), so naclUtil.decodeUTF8 — which truncates above
      // U+00FF — is lossless here. Do NOT swap stringify for a UTF-8 emitter
      // (e.g. a debug pretty-printer) without also swapping decodeUTF8 for a
      // real UTF-8 encoder; otherwise high codepoints get silently corrupted
      // and signature verification fails on the receiver.
      payloadB64 = naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(envelope)));
    } catch (e) {
      console.warn('[MultipeerService] envelope serialize failed:', e);
      return false;
    }
    // MCSession recommends <64 KB per message and crashes near 256 KB on older
    // hardware. Drop with a warning rather than risk a session reset.
    if (payloadB64.length > 60_000) {
      console.warn(
        `[MultipeerService] envelope ${payloadB64.length}B exceeds 60KB limit; dropping`,
      );
      return false;
    }
    try {
      return await meshMultipeer.send(payloadB64, peerNames);
    } catch (e) {
      console.warn('[MultipeerService] send failed:', e);
      return false;
    }
  }

  /**
   * Pre-seed the forwarding-dedup set with an envelope we just originated.
   * Without this, a peer's bounce-back of our own broadcast would re-trigger
   * the forward path and re-broadcast it to all our other peers. Mirrors
   * TcpMeshService.rememberOutgoing's seenForwarded pre-population.
   */
  rememberOutgoing(env: WireEnvelope): void {
    if (env && typeof env.pubKey === 'string' && typeof env.lamport === 'number') {
      this.markForwarded(`${env.pubKey}:${env.lamport}`);
    }
  }

  /**
   * Re-broadcast a received envelope to other MPC peers so it propagates
   * across a multi-hop chain (A→B→C even when A and C aren't direct peers).
   * The seenForwarded set guarantees each envelope is forwarded at most once,
   * so it cannot loop forever. Mirrors TcpMeshService.handleEnvelope.
   */
  private forwardEnvelope(env: WireEnvelope, sourceName?: string): void {
    // Don't forward CATCHUP — those are bulk replays for a single recipient.
    // Don't forward malformed envelopes (defensive — verify happens upstream).
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
    this.markForwarded(fwdKey);

    // Targeted relay to every connected peer except the source. The native
    // module exposes the sender's display name, so we can suppress the echo
    // at the source; receivers' dedup absorbs anything that slips past.
    void (async () => {
      let peerNames: string[];
      try {
        peerNames = await meshMultipeer.getConnectedPeers();
      } catch (err) {
        console.warn('[MultipeerService] getConnectedPeers failed during forward:', err);
        return;
      }
      const targets = peerNames.filter((name) => name !== sourceName);
      if (targets.length === 0) return;
      try {
        await this.sendInternal(env, targets);
      } catch (err) {
        console.warn('[MultipeerService] forward send failed:', err);
      }
    })();
  }

  /** Record a forward key in the bounded dedup set (FIFO eviction). */
  private markForwarded(key: string): void {
    if (this.seenForwarded.has(key)) return;
    this.seenForwarded.add(key);
    this.seenForwardedOrder.push(key);
    if (this.seenForwardedOrder.length > FORWARD_SEEN_CAP) {
      const drop = this.seenForwardedOrder.shift();
      if (drop !== undefined) this.seenForwarded.delete(drop);
    }
  }

  async getConnectedPeerCount(): Promise<number> {
    if (!meshMultipeer.isAvailable()) return 0;
    try {
      const peers = await meshMultipeer.getConnectedPeers();
      return peers.length;
    } catch {
      return 0;
    }
  }
}

export const multipeerService = new MultipeerService();
