import { requireOptionalNativeModule } from 'expo-modules-core';

// ---------- Types ----------

export type DiscoveredPeerInfo = { name: string; info: Record<string, string> };
export type PeerState = 'connecting' | 'connected' | 'notConnected';

export type MeshMultipeerEvents = {
  onStateChange: (e: { state: 'started' | 'stopped' | 'error'; message?: string }) => void;
  onPeerFound: (e: { name: string; info: Record<string, string> }) => void;
  onPeerLost: (e: { name: string }) => void;
  onPeerStateChange: (e: { name: string; state: PeerState }) => void;
  onDataReceived: (e: { from: string; payloadBase64: string }) => void;
};

export type StartOptions = {
  serviceType?: string;
  displayName?: string;
  discoveryInfo?: Record<string, string>;
};

// ---------- Native module shape ----------

type NativeModule = {
  start: (opts: StartOptions) => Promise<void>;
  stop: () => Promise<void>;
  send: (payloadBase64: string, peerNames?: string[] | null) => Promise<boolean>;
  getConnectedPeers: () => Promise<string[]>;
  getDiscoveredPeers: () => Promise<DiscoveredPeerInfo[]>;
  invitePeer: (peerName: string) => Promise<boolean>;
  // Expo SDK 52+ native modules are themselves EventEmitter instances, so
  // addListener is callable directly on the object returned by requireOptionalNativeModule.
  addListener: <K extends keyof MeshMultipeerEvents>(
    eventName: K,
    listener: MeshMultipeerEvents[K]
  ) => { remove: () => void };
};

const native = requireOptionalNativeModule<NativeModule>('MeshMultipeerModule');

// ---------- Wrapper ----------

class MeshMultipeer {
  isAvailable(): boolean {
    return native !== null;
  }

  async start(opts: StartOptions): Promise<void> {
    if (!native) return;
    await native.start(opts);
  }

  async stop(): Promise<void> {
    if (!native) return;
    await native.stop();
  }

  async send(payloadBase64: string, peerNames?: string[]): Promise<boolean> {
    if (!native) return false;
    return native.send(payloadBase64, peerNames ?? null);
  }

  async getConnectedPeers(): Promise<string[]> {
    if (!native) return [];
    return native.getConnectedPeers();
  }

  async getDiscoveredPeers(): Promise<DiscoveredPeerInfo[]> {
    if (!native) return [];
    return native.getDiscoveredPeers();
  }

  async invitePeer(peerName: string): Promise<boolean> {
    if (!native) return false;
    return native.invitePeer(peerName);
  }

  addListener<K extends keyof MeshMultipeerEvents>(
    event: K,
    handler: MeshMultipeerEvents[K]
  ): () => void {
    if (!native) {
      // No-op subscription on platforms without the native module.
      return () => {
        // intentionally empty
      };
    }
    const sub = native.addListener(event, handler);
    return () => {
      sub.remove();
    };
  }
}

export const meshMultipeer = new MeshMultipeer();
