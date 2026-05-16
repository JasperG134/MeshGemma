import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Incident, MOCK_FEED } from '../services/MockDatabase';
import {
  tcpMeshService,
  WireEnvelope,
  InnerMessage,
  BroadcastTarget,
  LocationPayload,
} from '../services/TcpMeshService';
import { cryptoService, Identity } from '../services/CryptoService';
import { discoveryService, DiscoveredPeer } from '../services/DiscoveryService';
import { multipeerService } from '../services/MultipeerService';
import { bleBeaconService } from '../services/BleBeaconService';
import { locationService } from '../services/LocationService';

type ReadyState = 'booting' | 'ready' | 'error';

export type ChatMessage = {
  id: string;
  pubKey: string;
  shortId: string;
  displayName?: string;  // sender-supplied friendly name; falls back to NODE-shortId in UI
  text: string;
  ts: number;
  isMine: boolean;
};

// One signed location report per peer. We keep the most recent verified value
// per pubKey; ts is the sender's clock at the time of broadcast and lastSeen
// is our wall clock when we received it. `isLive` is derived in the UI from
// (Date.now() - lastSeen) < LIVE_WINDOW_MS.
export type PeerLocation = {
  pubKey: string;
  shortId: string;
  displayName?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  ts: number;
  lastSeen: number;
};

type AppContextType = {
  feed: Incident[];
  addIncident: (incident: Incident) => Promise<void>;
  setVisionAnalysis: (incidentId: string, analysis: string) => void;
  serverIp: string;
  setServerIp: (ip: string) => void;
  aiComputeMode: 'remote' | 'local';
  setAiComputeMode: (mode: 'remote' | 'local') => void;
  identity: Identity | null;
  ready: ReadyState;
  peers: DiscoveredPeer[];
  broadcastIncident: (incident: Incident) => Promise<void>;
  chats: ChatMessage[];
  sendChat: (text: string) => Promise<void>;
  clearFeed: () => Promise<void>;
  clearChats: () => Promise<void>;
  displayName: string;
  setDisplayName: (name: string) => Promise<void>;
  mpcAvailable: boolean;
  mpcPeerCount: number;
  peerLocations: PeerLocation[];
  broadcastMyLocation: () => Promise<boolean>;
  clearPeerLocations: () => Promise<void>;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

const FEED_KEY = '@feed';
const IP_KEY = '@serverIp';
const AI_MODE_KEY = '@aiComputeMode';
const SEEN_KEY = '@meshgemma:seenMessages:v1';
const CHATS_KEY = '@meshgemma:chats:v1';
const DISPLAY_NAME_KEY = '@meshgemma:displayName:v1';
const PEER_LOC_KEY = '@meshgemma:peerLocations:v1';
const SEEN_LIMIT = 500;
const CHAT_LIMIT = 200;
const DISPLAY_NAME_MAX = 24;
// How often we re-broadcast our own location while the app is foreground.
// 30 s balances battery vs. the 60 s "live" window the map uses.
const LOCATION_BROADCAST_INTERVAL_MS = 30_000;
// Max peer locations we keep cached. Plenty for a hackathon mesh; LRU on size.
const PEER_LOC_LIMIT = 64;

type SeenSet = Set<string>;

function seenKey(env: WireEnvelope): string {
  // Dedup by sender pubkey + lamport — guarantees exactly-once across resends.
  return `${env.pubKey}:${env.lamport}`;
}

function chatIdFor(env: WireEnvelope): string {
  return `${env.pubKey}:${env.lamport}`;
}

function shortIdOf(pubKey: string): string {
  return pubKey.slice(0, 8);
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [feed, setFeed] = useState<Incident[]>([]);
  const [serverIp, setServerIpState] = useState<string>('192.168.1.100');
  const [aiComputeMode, setAiComputeModeState] = useState<'remote' | 'local'>('remote');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState<ReadyState>('booting');
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [mpcPeerCount, setMpcPeerCount] = useState<number>(0);
  const [displayName, setDisplayNameState] = useState<string>('');
  const [peerLocations, setPeerLocations] = useState<PeerLocation[]>([]);
  const displayNameRef = useRef<string>('');
  const mpcAvailable = multipeerService.isAvailable();

  const seenRef = useRef<SeenSet>(new Set());
  const identityRef = useRef<Identity | null>(null);
  const peersRef = useRef<DiscoveredPeer[]>([]);
  const knownPeerIdsRef = useRef<Set<string>>(new Set());

  const persistSeen = useCallback(async (set: SeenSet) => {
    const arr = Array.from(set).slice(-SEEN_LIMIT);
    try {
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(arr));
    } catch (e) {
      console.warn('Failed to persist seen set:', e);
    }
  }, []);

  const persistFeed = useCallback(async (next: Incident[]) => {
    try {
      await AsyncStorage.setItem(FEED_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('Failed to persist feed:', e);
    }
  }, []);

  const persistChats = useCallback(async (next: ChatMessage[]) => {
    try {
      await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(next.slice(-CHAT_LIMIT)));
    } catch (e) {
      console.warn('Failed to persist chats:', e);
    }
  }, []);

  const persistPeerLocations = useCallback(async (next: PeerLocation[]) => {
    try {
      // Keep the most-recently-seen entries if we exceed the cap.
      const sorted = [...next].sort((a, b) => b.lastSeen - a.lastSeen);
      const trimmed = sorted.slice(0, PEER_LOC_LIMIT);
      await AsyncStorage.setItem(PEER_LOC_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('Failed to persist peerLocations:', e);
    }
  }, []);

  // Apply a verified envelope to local state. Skips the seen check — the
  // caller must do that. This is a single function so the direct-receive path
  // and the CATCHUP-iteration path use exactly the same semantics.
  const applyVerifiedEnvelope = useCallback((env: WireEnvelope) => {
    const inner = env.payload as InnerMessage;
    if (inner.kind === 'INCIDENT') {
      const incident = inner.data;
      setFeed((prev) => {
        if (prev.find((i) => i.id === incident.id)) return prev;
        const next = [incident, ...prev];
        persistFeed(next);
        return next;
      });
    } else if (inner.kind === 'LOCATION') {
      const loc = inner.data;
      if (
        !loc ||
        typeof loc.lat !== 'number' ||
        typeof loc.lng !== 'number' ||
        !Number.isFinite(loc.lat) ||
        !Number.isFinite(loc.lng)
      ) {
        return;
      }
      const senderShort = shortIdOf(env.pubKey);
      const friendly = typeof loc.displayName === 'string' && loc.displayName.trim().length > 0
        ? loc.displayName.trim().slice(0, DISPLAY_NAME_MAX)
        : undefined;
      const entry: PeerLocation = {
        pubKey: env.pubKey,
        shortId: senderShort,
        displayName: friendly,
        lat: loc.lat,
        lng: loc.lng,
        accuracy: typeof loc.accuracy === 'number' && Number.isFinite(loc.accuracy)
          ? loc.accuracy
          : undefined,
        ts: env.ts,
        lastSeen: Date.now(),
      };
      setPeerLocations((prev) => {
        // Keep the freshest report per pubKey by sender's ts. Older bounce-backs
        // from CATCHUP relays don't overwrite a newer live position.
        const existing = prev.find((p) => p.pubKey === env.pubKey);
        if (existing && existing.ts >= entry.ts) {
          // Still bump lastSeen so "live" status reflects the relay arrival.
          const refreshed = prev.map((p) =>
            p.pubKey === env.pubKey ? { ...p, lastSeen: Date.now() } : p,
          );
          persistPeerLocations(refreshed);
          return refreshed;
        }
        const next = existing
          ? prev.map((p) => (p.pubKey === env.pubKey ? entry : p))
          : [...prev, entry];
        persistPeerLocations(next);
        return next;
      });
    } else if (inner.kind === 'CHAT') {
      // The sender's `from` field carries either their friendly displayName
      // or, when none is set, their shortId. Prefer it as the rendered label.
      const fromRaw = typeof inner.data.from === 'string' ? inner.data.from.trim() : '';
      const senderShort = shortIdOf(env.pubKey);
      const friendly = fromRaw && fromRaw !== senderShort ? fromRaw : undefined;
      const msg: ChatMessage = {
        id: chatIdFor(env),
        pubKey: env.pubKey,
        shortId: senderShort,
        displayName: friendly,
        text: inner.data.text,
        ts: env.ts,
        isMine: false,
      };
      setChats((prev) => {
        if (prev.find((c) => c.id === msg.id)) return prev;
        const next = [...prev, msg];
        // Keep newest chats bounded.
        const trimmed = next.length > CHAT_LIMIT ? next.slice(-CHAT_LIMIT) : next;
        persistChats(trimmed);
        return trimmed;
      });
    }
    // PING: nothing to apply locally.
  }, [persistChats, persistFeed, persistPeerLocations]);

  useEffect(() => {
    let isMounted = true;
    let unsubscribeDiscovery: (() => void) | null = null;
    let unsubscribeMesh: (() => void) | null = null;
    let unsubscribeMpc: (() => void) | null = null;

    const boot = async () => {
      // 1) Identity
      let id: Identity;
      try {
        id = await cryptoService.init();
        if (!isMounted) return;
        identityRef.current = id;
        setIdentity(id);
      } catch (e) {
        console.error('CryptoService init failed:', e);
        if (isMounted) setReady('error');
        return;
      }

      // 2) Restore persisted state. Use allSettled so one corrupt key can't
      // wipe everything else; failures are isolated per slot.
      const [resFeed, resIp, resMode, resSeen, resChats, resName, resPeerLoc] = await Promise.allSettled([
        AsyncStorage.getItem(FEED_KEY),
        AsyncStorage.getItem(IP_KEY),
        AsyncStorage.getItem(AI_MODE_KEY),
        AsyncStorage.getItem(SEEN_KEY),
        AsyncStorage.getItem(CHATS_KEY),
        AsyncStorage.getItem(DISPLAY_NAME_KEY),
        AsyncStorage.getItem(PEER_LOC_KEY),
      ]);

      const storedFeed = resFeed.status === 'fulfilled' ? resFeed.value : null;
      const storedIp = resIp.status === 'fulfilled' ? resIp.value : null;
      const storedMode = resMode.status === 'fulfilled' ? resMode.value : null;
      const storedSeen = resSeen.status === 'fulfilled' ? resSeen.value : null;
      const storedChats = resChats.status === 'fulfilled' ? resChats.value : null;
      const storedName = resName.status === 'fulfilled' ? resName.value : null;
      const storedPeerLoc = resPeerLoc.status === 'fulfilled' ? resPeerLoc.value : null;

      if (!isMounted) return;

      let parsedFeed: Incident[] = [];
      if (storedFeed) {
        try {
          const arr = JSON.parse(storedFeed);
          if (Array.isArray(arr)) parsedFeed = arr;
        } catch (e) {
          console.warn('Failed to parse feed:', e);
        }
      }
      if (parsedFeed.length > 0) {
        setFeed(parsedFeed);
      } else if (MOCK_FEED.length > 0) {
        setFeed(MOCK_FEED);
        AsyncStorage.setItem(FEED_KEY, JSON.stringify(MOCK_FEED)).catch((e) => {
          console.warn('Failed to seed feed:', e);
        });
      } else {
        setFeed([]);
      }

      if (storedIp) setServerIpState(storedIp);
      if (storedMode === 'remote' || storedMode === 'local') {
        setAiComputeModeState(storedMode);
      }

      if (storedSeen) {
        try {
          const arr = JSON.parse(storedSeen);
          if (Array.isArray(arr)) {
            seenRef.current = new Set(arr.filter((x): x is string => typeof x === 'string'));
          }
        } catch (e) {
          console.warn('Failed to parse seen set:', e);
        }
      }

      if (typeof storedName === 'string' && storedName.length > 0) {
        const trimmed = storedName.slice(0, DISPLAY_NAME_MAX);
        displayNameRef.current = trimmed;
        setDisplayNameState(trimmed);
      }

      if (storedChats) {
        try {
          const arr = JSON.parse(storedChats);
          if (Array.isArray(arr)) {
            // After app restart, the user's own pubKey should still mark
            // their own messages as mine. Re-evaluate isMine against current id.
            const fixed = (arr as ChatMessage[]).map((c) => ({ ...c, isMine: c.pubKey === id.pubKey }));
            setChats(fixed);
          }
        } catch (e) {
          console.warn('Failed to parse chats:', e);
        }
      }

      if (storedPeerLoc) {
        try {
          const arr = JSON.parse(storedPeerLoc);
          if (Array.isArray(arr)) {
            // Drop our own pubKey from the cache (in case identity rotated and
            // a stale self-entry was persisted). Other peers stay as last-known.
            const fixed = (arr as PeerLocation[]).filter(
              (p) =>
                p &&
                typeof p.pubKey === 'string' &&
                p.pubKey !== id.pubKey &&
                Number.isFinite(p.lat) &&
                Number.isFinite(p.lng),
            );
            setPeerLocations(fixed);
          }
        } catch (e) {
          console.warn('Failed to parse peerLocations:', e);
        }
      }

      // 3) Inbound envelope handler — used by every transport (TCP + MPC).
      const handleInbound = (env: WireEnvelope) => {
        // Self-loopback: ignore anything we signed ourselves.
        if (!env || env.pubKey === identityRef.current?.pubKey) return;

        // Cheap shape gate before paying for an Ed25519 verify.
        if (typeof env.pubKey !== 'string' || typeof env.lamport !== 'number') return;

        // Dedup BEFORE verify. Duplicate fan-in across transports (TCP + MPC)
        // would otherwise pay a full verify per delivery and bump our local
        // lamport every time, eroding the boot reserve.
        const dedupKeyEarly = seenKey(env);
        const inner = env.payload as InnerMessage;
        const isCatchup = inner && inner.kind === 'CATCHUP';
        // CATCHUP envelopes themselves are dedup'd by their outer (pubKey, lamport),
        // not skipped on a hit — we still want to process inner sub-envelopes that
        // might be new even if we've seen this exact catchup before. So only dedup
        // here for non-catchup direct deliveries.
        if (!isCatchup && seenRef.current.has(dedupKeyEarly)) return;

        // Verify the envelope. Drops bad signatures + bumps lamport.
        if (!cryptoService.verify(env)) {
          console.warn('Dropping unverified envelope from', env?.pubKey);
          return;
        }
        if (inner.kind === 'CATCHUP') {
          for (const sub of inner.data.envelopes) {
            if (!sub || sub.pubKey === identityRef.current?.pubKey) continue;
            const subKey = seenKey(sub);
            if (seenRef.current.has(subKey)) continue;
            if (!cryptoService.verify(sub)) {
              console.warn('Catchup contained an unverified envelope; skipping');
              continue;
            }
            // Don't recurse on nested CATCHUPs.
            const subInner = sub.payload as InnerMessage;
            if (subInner.kind === 'CATCHUP') continue;
            seenRef.current.add(subKey);
            applyVerifiedEnvelope(sub);
          }
          // Persist the seen-set growth from the bundle.
          if (seenRef.current.size > SEEN_LIMIT * 2) {
            const trimmed = Array.from(seenRef.current).slice(-SEEN_LIMIT);
            seenRef.current = new Set(trimmed);
          }
          persistSeen(seenRef.current);
          return;
        }

        // Direct delivery (INCIDENT, CHAT, PING). Dedup was checked above
        // before the verify, so just record-and-apply here.
        seenRef.current.add(dedupKeyEarly);
        if (seenRef.current.size > SEEN_LIMIT * 2) {
          const trimmed = Array.from(seenRef.current).slice(-SEEN_LIMIT);
          seenRef.current = new Set(trimmed);
        }
        persistSeen(seenRef.current);

        applyVerifiedEnvelope(env);
      };

      // 3a) TCP transport.
      unsubscribeMesh = tcpMeshService.subscribe(handleInbound);
      tcpMeshService.startServer();

      // 3b) MultipeerConnectivity transport (additive, off-grid via BT/WiFi-Direct).
      unsubscribeMpc = multipeerService.subscribe(handleInbound);
      multipeerService.start({ myPubKey: id.pubKey, myShortId: id.shortId }).catch((err) => {
        console.warn('MultipeerService start failed:', err);
      });

      // Catchup-on-MPC-connect: when a peer transitions to 'connected', send
      // them our recent buffer so they don't miss state from before they joined.
      // (TCP catchup is driven off mDNS; this is the off-grid equivalent.)
      const unsubMpcState = multipeerService.onPeerStateChange((evt) => {
        // Refresh peer count for the UI on every state change.
        multipeerService.getConnectedPeerCount().then((n) => {
          if (isMounted) setMpcPeerCount(n);
        }).catch(() => { /* best-effort */ });

        if (evt.state !== 'connected') return;
        const me = identityRef.current;
        if (!me) return;
        const recent = tcpMeshService.getRecent();
        if (recent.length === 0) return;

        // Both sides fire 'connected' on a fresh MPC link. Without a
        // tiebreak, both peers send their full recent buffer on every reconnect
        // — 2x bandwidth burst per pair, scaling badly with N peers. Only the
        // peer with the lexicographically lower MPC display name initiates the
        // catchup. Receiver dedups, but this halves the wire traffic.
        const myMpcName = `MG-${me.shortId}`;
        if (myMpcName >= evt.name) return;

        try {
          const catchupInner: InnerMessage = {
            kind: 'CATCHUP',
            data: { envelopes: recent },
          };
          const catchupEnv = cryptoService.sign<InnerMessage>(catchupInner);
          multipeerService.sendTo(catchupEnv, [evt.name]).catch((err) => {
            console.warn('MPC catchup send failed:', err);
          });
        } catch (err) {
          console.warn('Building MPC catchup failed:', err);
        }
      });
      const prevUnsubMesh = unsubscribeMesh;
      unsubscribeMesh = () => {
        if (prevUnsubMesh) prevUnsubMesh();
        unsubMpcState();
      };

      // 3c) BLE peripheral beacon — proximity-only, no data exchange.
      bleBeaconService.start({ pubKey: id.pubKey, shortId: id.shortId }).catch((err) => {
        console.warn('BleBeaconService start failed:', err);
      });

      // 4) Discovery — also drives catchup-on-new-peer.
      unsubscribeDiscovery = discoveryService.subscribe((list) => {
        peersRef.current = list;
        if (isMounted) setPeers(list);

        // Detect newly-resolved peers and send them our recent envelopes.
        const myId = identityRef.current;
        if (!myId) return;
        const known = knownPeerIdsRef.current;
        for (const p of list) {
          if (known.has(p.id)) continue;
          // Skip self by pubKey.
          if (p.pubKey && p.pubKey === myId.pubKey) {
            known.add(p.id);
            continue;
          }
          // Wait until we have a usable IP — they'll re-resolve and we'll see it.
          if (!p.ip) continue;
          known.add(p.id);
          const recent = tcpMeshService.getRecent();
          if (recent.length === 0) continue;
          try {
            const catchupInner: InnerMessage = {
              kind: 'CATCHUP',
              data: { envelopes: recent },
            };
            const catchupEnv = cryptoService.sign<InnerMessage>(catchupInner);
            tcpMeshService
              .sendCatchup({ ip: p.ip, port: p.port || tcpMeshService.getPort() }, catchupEnv)
              .catch((err) => console.warn('Catchup send failed:', err));
          } catch (err) {
            console.warn('Building catchup failed:', err);
          }
        }
        // Prune known set to current ids so reconnects after disappearance trigger again.
        const currentIds = new Set(list.map((p) => p.id));
        for (const id of Array.from(known)) {
          if (!currentIds.has(id)) known.delete(id);
        }
      });
      try {
        // displayNameRef may have been hydrated from AsyncStorage above; if
        // empty, fall back to the auto-generated NODE name.
        const friendly = displayNameRef.current.trim();
        const advertisedName = friendly.length > 0
          ? friendly
          : `MeshGemma-${id.shortId}`;
        await discoveryService.start({
          myPubKey: id.pubKey,
          myShortId: id.shortId,
          myName: advertisedName,
          port: tcpMeshService.getPort(),
        });
      } catch (e) {
        console.warn('DiscoveryService start failed:', e);
      }

      if (isMounted) setReady('ready');
    };

    boot();

    return () => {
      isMounted = false;
      // Each cleanup step independently so a sync throw in one doesn't skip
      // the rest. StrictMode hits this path twice in dev.
      try { if (unsubscribeMesh) unsubscribeMesh(); } catch (e) { console.warn('cleanup mesh unsub:', e); }
      try { if (unsubscribeMpc) unsubscribeMpc(); } catch (e) { console.warn('cleanup mpc unsub:', e); }
      try { if (unsubscribeDiscovery) unsubscribeDiscovery(); } catch (e) { console.warn('cleanup discovery unsub:', e); }
      try { discoveryService.stop().catch(() => {}); } catch (e) { console.warn('cleanup discovery stop:', e); }
      try { tcpMeshService.stopServer(); } catch (e) { console.warn('cleanup tcp stop:', e); }
      try { multipeerService.stop().catch(() => {}); } catch (e) { console.warn('cleanup mpc stop:', e); }
      try { bleBeaconService.stop().catch(() => {}); } catch (e) { console.warn('cleanup ble stop:', e); }
    };
  }, [applyVerifiedEnvelope, persistSeen]);

  const setServerIp = async (ip: string) => {
    setServerIpState(ip);
    try {
      await AsyncStorage.setItem(IP_KEY, ip);
    } catch (e) {
      console.warn('Failed to save server IP:', e);
    }
  };

  const clearFeed = useCallback(async () => {
    setFeed([]);
    seenRef.current = new Set();
    try {
      await AsyncStorage.multiRemove([FEED_KEY, SEEN_KEY]);
    } catch (e) {
      console.warn('Failed to clear feed storage:', e);
    }
  }, []);

  const clearChats = useCallback(async () => {
    setChats([]);
    try {
      await AsyncStorage.removeItem(CHATS_KEY);
    } catch (e) {
      console.warn('Failed to clear chats storage:', e);
    }
  }, []);

  // Persist + apply a friendly display name. Empty string clears it.
  // Bounces the mDNS service so peers' cards reflect the new name on their
  // next resolve (~1-3 sec). Already-sent envelopes keep their old `from`/
  // `author` since those are signed bytes — only future messages will carry
  // the new name.
  const setDisplayName = useCallback(async (name: string) => {
    const trimmed = name.trim().slice(0, DISPLAY_NAME_MAX);
    displayNameRef.current = trimmed;
    setDisplayNameState(trimmed);
    try {
      if (trimmed.length === 0) {
        await AsyncStorage.removeItem(DISPLAY_NAME_KEY);
      } else {
        await AsyncStorage.setItem(DISPLAY_NAME_KEY, trimmed);
      }
    } catch (e) {
      console.warn('Failed to persist displayName:', e);
    }

    // Re-publish mDNS so peers see the updated TXT.name. Needs identity ready.
    const me = identityRef.current;
    if (!me) return;
    try {
      await discoveryService.stop();
    } catch (e) {
      console.warn('Failed to stop discovery on rename:', e);
    }
    try {
      const advertisedName = trimmed.length > 0 ? trimmed : `MeshGemma-${me.shortId}`;
      await discoveryService.start({
        myPubKey: me.pubKey,
        myShortId: me.shortId,
        myName: advertisedName,
        port: tcpMeshService.getPort(),
      });
    } catch (e) {
      console.warn('Failed to restart discovery on rename:', e);
    }
  }, []);

  const setAiComputeMode = async (mode: 'remote' | 'local') => {
    setAiComputeModeState(mode);
    try {
      await AsyncStorage.setItem(AI_MODE_KEY, mode);
    } catch (e) {
      console.warn('Failed to save AI compute mode:', e);
    }
  };

  const broadcastIncident = useCallback(async (incident: Incident) => {
    if (!identityRef.current) {
      console.warn('broadcastIncident before identity ready');
      return;
    }
    const inner: InnerMessage = { kind: 'INCIDENT', data: incident };
    const envelope = cryptoService.sign<InnerMessage>(inner);

    // Mark as seen ourselves so a bounce doesn't redeliver.
    seenRef.current.add(seenKey(envelope));
    persistSeen(seenRef.current);

    // Replay-buffer feed for late peers.
    tcpMeshService.rememberOutgoing(envelope);
    // Pre-seed the MPC forward-dedup so a peer's echo of our own broadcast
    // doesn't get re-forwarded back out to our other MPC peers.
    multipeerService.rememberOutgoing(envelope);

    // Fan out over every available transport. MPC reaches off-grid peers
    // directly; TCP reaches WiFi peers found via mDNS. Each transport runs
    // its own dedup so duplicate delivery on the receiver side is impossible.
    const targets: BroadcastTarget[] = peersRef.current
      .filter((p) => !!p.ip)
      .map((p) => ({ ip: p.ip, port: p.port || tcpMeshService.getPort() }));

    const tcpPromise = targets.length > 0
      ? tcpMeshService.broadcast(envelope, targets).then((result) => {
          if (result.failed.length > 0) {
            console.warn(`TCP broadcast: ${result.ok.length} ok, ${result.failed.length} failed`);
          }
        })
      : Promise.resolve();

    const mpcPromise = multipeerService.broadcast(envelope).catch((err) => {
      console.warn('MPC broadcast failed:', err);
      return false;
    });

    await Promise.allSettled([tcpPromise, mpcPromise]);
  }, [persistSeen]);

  // Broadcast our current GPS as a signed LOCATION envelope. Reuses the same
  // fan-out path as INCIDENT/CHAT, so multi-hop relay works for free via
  // TcpMeshService's forwarding layer (envelopes hop A→B→C→D and the
  // receiver-side dedup absorbs loop-backs). Returns true on send attempt,
  // false if there's no fix to send.
  const broadcastMyLocation = useCallback(async (): Promise<boolean> => {
    if (!identityRef.current) return false;
    let coords = locationService.getLastKnown();
    if (!coords) {
      try {
        coords = await locationService.getCurrentCoords(6000);
      } catch (e) {
        // Permission denied / disabled — silently bail; we'll retry next tick.
        return false;
      }
    }
    if (!coords) return false;

    const friendly = displayNameRef.current.trim();
    const payload: LocationPayload = {
      lat: coords.lat,
      lng: coords.lng,
      ...(friendly.length > 0 ? { displayName: friendly } : {}),
      ...(typeof coords.accuracy === 'number' && Number.isFinite(coords.accuracy)
        ? { accuracy: coords.accuracy }
        : {}),
    };
    const inner: InnerMessage = { kind: 'LOCATION', data: payload };
    let envelope: WireEnvelope;
    try {
      envelope = cryptoService.sign<InnerMessage>(inner);
    } catch (e) {
      console.warn('broadcastMyLocation sign failed:', e);
      return false;
    }

    seenRef.current.add(seenKey(envelope));
    persistSeen(seenRef.current);
    // Park in the recent-outgoing buffer so freshly-discovered peers receive
    // it via CATCHUP without waiting for the next interval tick.
    tcpMeshService.rememberOutgoing(envelope);
    // Pre-seed the MPC forward-dedup so an echo of our own LOCATION isn't
    // re-forwarded back out to our other MPC peers.
    multipeerService.rememberOutgoing(envelope);

    const targets: BroadcastTarget[] = peersRef.current
      .filter((p) => !!p.ip)
      .map((p) => ({ ip: p.ip, port: p.port || tcpMeshService.getPort() }));

    const tcpPromise = targets.length > 0
      ? tcpMeshService.broadcast(envelope, targets).catch((err) => {
          console.warn('LOCATION TCP broadcast failed:', err);
        })
      : Promise.resolve();
    const mpcPromise = multipeerService.broadcast(envelope).catch((err) => {
      console.warn('LOCATION MPC broadcast failed:', err);
      return false;
    });
    await Promise.allSettled([tcpPromise, mpcPromise]);
    return true;
  }, [persistSeen]);

  // Periodic location heartbeat. Fires every LOCATION_BROADCAST_INTERVAL_MS
  // once identity is ready. We don't try to gate this on "has any peer" —
  // the broadcast pipeline is no-op if there are no peers, but the envelope
  // still goes into the recent buffer so a peer that joins seconds later
  // gets it on CATCHUP. So the interval keeps running.
  useEffect(() => {
    if (ready !== 'ready') return;
    let cancelled = false;
    // Fire one immediately so the user doesn't wait 30s for the first emit.
    void broadcastMyLocation();
    const t = setInterval(() => {
      if (cancelled) return;
      void broadcastMyLocation();
    }, LOCATION_BROADCAST_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [ready, broadcastMyLocation]);

  const clearPeerLocations = useCallback(async () => {
    setPeerLocations([]);
    try {
      await AsyncStorage.removeItem(PEER_LOC_KEY);
    } catch (e) {
      console.warn('Failed to clear peerLocations storage:', e);
    }
  }, []);

  // Local-only update: stores Gemma's vision description on the device's copy
  // of the incident. NOT broadcast — visionAnalysis is intentionally not part
  // of the signed envelope, so this just mutates local state + persistence.
  const setVisionAnalysis = useCallback((incidentId: string, analysis: string) => {
    setFeed((prev) => {
      let changed = false;
      const next = prev.map((i) => {
        if (i.id === incidentId) {
          changed = true;
          return { ...i, visionAnalysis: analysis };
        }
        return i;
      });
      if (!changed) return prev;
      persistFeed(next);
      return next;
    });
  }, [persistFeed]);

  const addIncident = useCallback(async (incident: Incident) => {
    setFeed((prev) => {
      if (prev.find((i) => i.id === incident.id)) return prev;
      const next = [incident, ...prev];
      persistFeed(next);
      return next;
    });
    await broadcastIncident(incident);
  }, [broadcastIncident, persistFeed]);

  const sendChat = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text) return;
    const id = identityRef.current;
    if (!id) {
      throw new Error('Identity not ready');
    }
    const friendly = displayNameRef.current.trim();
    const fromLabel = friendly.length > 0 ? friendly : id.shortId;
    const inner: InnerMessage = { kind: 'CHAT', data: { text, from: fromLabel } };
    const envelope = cryptoService.sign<InnerMessage>(inner);

    seenRef.current.add(seenKey(envelope));
    persistSeen(seenRef.current);
    tcpMeshService.rememberOutgoing(envelope);
    // Pre-seed the MPC forward-dedup so an echo of our own chat message isn't
    // re-forwarded back out to our other MPC peers.
    multipeerService.rememberOutgoing(envelope);

    const myMsg: ChatMessage = {
      id: chatIdFor(envelope),
      pubKey: envelope.pubKey,
      shortId: id.shortId,
      displayName: friendly.length > 0 ? friendly : undefined,
      text,
      ts: envelope.ts,
      isMine: true,
    };
    setChats((prev) => {
      if (prev.find((c) => c.id === myMsg.id)) return prev;
      const next = [...prev, myMsg];
      const trimmed = next.length > CHAT_LIMIT ? next.slice(-CHAT_LIMIT) : next;
      persistChats(trimmed);
      return trimmed;
    });

    const targets: BroadcastTarget[] = peersRef.current
      .filter((p) => !!p.ip)
      .map((p) => ({ ip: p.ip, port: p.port || tcpMeshService.getPort() }));

    const tcpPromise = targets.length > 0
      ? tcpMeshService.broadcast(envelope, targets).then((result) => {
          if (result.failed.length > 0) {
            console.warn(`Chat TCP: ${result.ok.length} ok, ${result.failed.length} failed`);
          }
        })
      : Promise.resolve();

    const mpcPromise = multipeerService.broadcast(envelope).catch((err) => {
      console.warn('Chat MPC failed:', err);
      return false;
    });

    await Promise.allSettled([tcpPromise, mpcPromise]);
  }, [persistChats, persistSeen]);

  return (
    <AppContext.Provider
      value={{
        feed,
        addIncident,
        setVisionAnalysis,
        peerLocations,
        broadcastMyLocation,
        clearPeerLocations,
        serverIp,
        setServerIp,
        aiComputeMode,
        setAiComputeMode,
        identity,
        ready,
        peers,
        broadcastIncident,
        chats,
        sendChat,
        clearFeed,
        clearChats,
        displayName,
        setDisplayName,
        mpcAvailable,
        mpcPeerCount,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
