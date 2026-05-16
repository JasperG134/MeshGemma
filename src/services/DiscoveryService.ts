// DiscoveryService — mDNS/Bonjour peer auto-discovery for the MeshGemma mesh.
// Caveats: iOS requires NSBonjourServices in Info.plist (already added by integrator).
// iOS also requires the local-network usage prompt; first call to scan() triggers it.
// Android: NSD is used (default impl). Some emulators / restricted networks may not deliver events.

// The react-native-zeroconf package ships no .d.ts. We type just what we use.
type ZcEvent =
  | 'start'
  | 'stop'
  | 'found'
  | 'resolved'
  | 'remove'
  | 'error'
  | 'update'
  | 'published'
  | 'unpublished';

interface ZeroconfLike {
  scan(type?: string, protocol?: string, domain?: string): void;
  stop(): void;
  publishService(
    type: string,
    protocol: string,
    domain: string,
    name: string,
    port: number,
    txt?: Record<string, string>,
  ): void;
  unpublishService(name: string): void;
  on(event: ZcEvent, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: ZcEvent, listener: (...args: unknown[]) => void): unknown;
}

interface ZeroconfCtor {
  new (props?: unknown): ZeroconfLike;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Zeroconf = require('react-native-zeroconf').default as ZeroconfCtor;

export type DiscoveredPeer = {
  // Stable id. Use the service name from zeroconf, which is unique per host.
  id: string;
  name: string;             // zeroconf service name (e.g. "MeshGemma-{shortId}")
  host: string;             // resolved hostname or IP literal
  ip: string;               // resolved IPv4 (or IPv6 fallback). Empty string if not resolved yet.
  port: number;             // TCP port of the peer's mesh server
  pubKey?: string;          // base64 Ed25519 pubkey from TXT record, if present
  shortId?: string;         // 8-char display id from TXT record, if present
  displayName?: string;     // sender-supplied friendly name from TXT record, if present
  lastSeen: number;         // Date.now() when last advertised/resolved
};

export type DiscoveryListener = (peers: DiscoveredPeer[]) => void;

type StartOpts = {
  myPubKey: string;
  myShortId: string;
  myName?: string;
  port?: number;
};

// Loose shape of a resolved zeroconf service. The library has no .d.ts so we
// narrow at the boundary instead of leaking `any` further.
type ResolvedService = {
  name?: string;
  host?: string;
  port?: number;
  addresses?: string[];
  txt?: Record<string, unknown>;
  fullName?: string;
};

const SERVICE_TYPE = 'meshgemma';
const SERVICE_PROTOCOL = 'tcp';
const SERVICE_DOMAIN = 'local.';
const DEFAULT_PORT = 4000;
const DEFAULT_NAME = 'MeshGemma Node';

class DiscoveryService {
  // Internal map keyed by zeroconf service name (unique per host).
  private peers = new Map<string, DiscoveredPeer>();
  private listeners = new Set<DiscoveryListener>();

  private zc: ZeroconfLike | null = null;
  private started = false;
  private inert = false; // true if zeroconf threw on this platform

  private myPubKey = '';
  private myShortId = '';
  private myName = DEFAULT_NAME;
  private myPort = DEFAULT_PORT;
  private publishedName = ''; // the unique name we publish ourselves under

  // Bound handlers (so add/remove pair correctly). Signatures use `unknown[]`
  // to satisfy the loose Zeroconf event signature; we narrow inside.
  private onFound = (...args: unknown[]): void => {
    const name = typeof args[0] === 'string' ? args[0] : '';
    if (!name) return;
    if (name === this.publishedName) return; // never list ourselves
    const existing = this.peers.get(name);
    if (existing) {
      existing.lastSeen = Date.now();
      this.peers.set(name, existing);
    } else {
      this.peers.set(name, {
        id: name,
        name,
        host: '',
        ip: '',
        port: 0,
        lastSeen: Date.now(),
      });
    }
    this.notify();
  };

  private onResolved = (...args: unknown[]): void => {
    const raw = args[0];
    const svc = (raw && typeof raw === 'object' ? raw : {}) as ResolvedService;
    if (!svc.name) return;
    if (svc.name === this.publishedName) return;

    const ip = pickIPv4(svc.addresses);
    const txt = svc.txt ?? {};
    const pubKey = typeof txt.pubKey === 'string' ? (txt.pubKey as string) : undefined;
    const shortId = typeof txt.shortId === 'string' ? (txt.shortId as string) : undefined;
    const txtName = typeof txt.name === 'string' ? (txt.name as string).trim() : '';
    // Suppress the auto-generated "MeshGemma-shortId" pseudo-name so it's only
    // surfaced when the user actually picked a friendly callsign.
    const displayName =
      txtName.length > 0 && !txtName.startsWith('MeshGemma-') ? txtName : undefined;

    // Filter self by pubKey match (in case our published name resolves back).
    if (pubKey && this.myPubKey && pubKey === this.myPubKey) {
      return;
    }

    const prev = this.peers.get(svc.name);
    const peer: DiscoveredPeer = {
      id: svc.name,
      name: svc.name,
      host: typeof svc.host === 'string' ? svc.host : prev?.host ?? '',
      ip: ip || prev?.ip || '',
      port: typeof svc.port === 'number' ? svc.port : prev?.port ?? 0,
      pubKey: pubKey ?? prev?.pubKey,
      shortId: shortId ?? prev?.shortId,
      displayName: displayName ?? prev?.displayName,
      lastSeen: Date.now(),
    };
    this.peers.set(svc.name, peer);
    this.notify();
  };

  private onRemove = (...args: unknown[]): void => {
    const name = typeof args[0] === 'string' ? args[0] : '';
    if (!name) return;
    if (this.peers.delete(name)) {
      this.notify();
    }
  };

  private onError = (...args: unknown[]): void => {
    // Library emits an Error here; just log so we don't crash.
    // eslint-disable-next-line no-console
    console.warn('[DiscoveryService] zeroconf error:', args[0]);
  };

  /**
   * Start advertising AND browsing. Idempotent — safe to call repeatedly.
   * If called again with different options without an intervening stop(),
   * the second call is a no-op and logs a warning.
   */
  async start(opts: StartOpts): Promise<void> {
    if (this.inert) return;

    const nextName = opts.myName ?? DEFAULT_NAME;
    const nextPort = opts.port ?? DEFAULT_PORT;

    if (this.started) {
      const changed =
        this.myPubKey !== opts.myPubKey ||
        this.myShortId !== opts.myShortId ||
        this.myName !== nextName ||
        this.myPort !== nextPort;
      if (changed) {
        // eslint-disable-next-line no-console
        console.warn(
          '[DiscoveryService] start() called again with different options; ignoring. Call stop() first.',
        );
      }
      return;
    }

    this.myPubKey = opts.myPubKey;
    this.myShortId = opts.myShortId;
    this.myName = nextName;
    this.myPort = nextPort;
    this.publishedName = `MeshGemma-${this.myShortId}`;

    try {
      const zc = new Zeroconf();
      this.zc = zc;

      zc.on('found', this.onFound);
      zc.on('resolved', this.onResolved);
      zc.on('remove', this.onRemove);
      zc.on('error', this.onError);

      // Begin browsing. iOS will trigger the local-network prompt here on first run.
      zc.scan(SERVICE_TYPE, SERVICE_PROTOCOL, SERVICE_DOMAIN);

      // Advertise self. TXT values must be strings — library coerces but be explicit.
      const txt: Record<string, string> = {
        pubKey: this.myPubKey,
        shortId: this.myShortId,
        name: this.myName,
      };
      zc.publishService(
        SERVICE_TYPE,
        SERVICE_PROTOCOL,
        SERVICE_DOMAIN,
        this.publishedName,
        this.myPort,
        txt,
      );

      this.started = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[DiscoveryService] failed to start zeroconf; service is inert on this platform.',
        err,
      );
      this.inert = true;
      this.zc = null;
      this.started = false;
    }
  }

  /** Stop advertising and browsing. Clears the peer list. */
  async stop(): Promise<void> {
    const zc = this.zc;
    this.zc = null;
    this.started = false;

    if (zc) {
      try {
        if (this.publishedName) {
          try {
            zc.unpublishService(this.publishedName);
          } catch {
            // best-effort
          }
        }
        try {
          zc.stop();
        } catch {
          // best-effort
        }
        zc.removeListener('found', this.onFound);
        zc.removeListener('resolved', this.onResolved);
        zc.removeListener('remove', this.onRemove);
        zc.removeListener('error', this.onError);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[DiscoveryService] error during stop():', err);
      }
    }

    this.publishedName = '';
    if (this.peers.size > 0) {
      this.peers.clear();
      this.notify();
    }
  }

  /** Current snapshot of known peers (excludes self by pubKey match). */
  getPeers(): DiscoveredPeer[] {
    const out: DiscoveredPeer[] = [];
    this.peers.forEach((peer) => {
      if (peer.pubKey && this.myPubKey && peer.pubKey === this.myPubKey) return;
      out.push(peer);
    });
    return out;
  }

  /**
   * Subscribe to peer-list changes. Returns unsubscribe fn.
   * Callback fires immediately with the current snapshot, then on every change.
   */
  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getPeers());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[DiscoveryService] listener threw on initial snapshot:', err);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getPeers();
    this.listeners.forEach((l) => {
      try {
        l(snapshot);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[DiscoveryService] listener threw:', err);
      }
    });
  }
}

function pickIPv4(addresses: string[] | undefined): string {
  if (!addresses || addresses.length === 0) return '';
  for (const a of addresses) {
    if (typeof a === 'string' && a.length > 0 && !a.includes(':')) return a;
  }
  const first = addresses[0];
  return typeof first === 'string' ? first : '';
}

export const discoveryService: DiscoveryService = new DiscoveryService();
