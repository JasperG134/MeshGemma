# MeshGemma — Architecture & Code Tour

A ~5-minute walk through how MeshGemma is built. Every section points at real
files so you can jump straight into the source.

---

## Project layout

```
mesh-gemma/
├── App.tsx                      # Root: SafeAreaProvider → AppProvider → 5-tab navigator
├── index.ts                     # Expo entry point
├── app.json                     # Expo config: plugins, iOS Bonjour services, permissions
├── src/
│   ├── context/AppContext.tsx   # Global state: identity, feed, peers, chat, mesh wiring
│   ├── screens/                 # One file per tab
│   │   ├── MeshScannerScreen.tsx
│   │   ├── OfflineMapScreen.tsx
│   │   ├── FeedScreen.tsx
│   │   ├── GemmaChatScreen.tsx   # "Analysis LPU" tab
│   │   └── ChatScreen.tsx
│   ├── components/
│   │   ├── RadioPanel.tsx        # Radio-uplink compression UI
│   │   └── PhotoIncidentCard.tsx # Photo attachment + ANALYZE button
│   ├── services/                # All the non-UI logic (see below)
│   ├── utils/                    # byteSize, imageResize helpers
│   └── theme/colors.ts
├── modules/                      # Two local Swift Expo modules (native mesh)
│   ├── mesh-multipeer/
│   └── mesh-ble-peripheral/
├── gpx/                          # Demo GPS tracks for the simulator
└── scripts/                      # Standalone .mjs unit checks
```

The app is a custom Expo dev-client build (Expo SDK 54, React Native 0.81,
TypeScript, iOS). It cannot run in Expo Go because of the native mesh modules.

---

## The three-transport mesh

All three transports are independent, run their own dedup, and feed the **same**
signed-envelope handler in `AppContext.tsx`. An envelope arriving over two
transports is verified once and delivered once.

| Transport | Service file | Native dependency | Role |
|---|---|---|---|
| WiFi / TCP + mDNS | `src/services/TcpMeshService.ts`, `src/services/DiscoveryService.ts` | `react-native-tcp-socket`, `react-native-zeroconf` | High-throughput data path; TCP server on port 4000; mDNS auto-discovery |
| MultipeerConnectivity | `src/services/MultipeerService.ts` | `modules/mesh-multipeer` (Swift) | Off-grid data path over Bluetooth + WiFi-Direct |
| BLE proximity beacon | `src/services/BleBeaconService.ts`, `src/services/BleMeshService.ts` | `modules/mesh-ble-peripheral` (Swift), `react-native-ble-plx` | Presence-only: makes phones visible on the radar |

- **`TcpMeshService`** runs the inbound TCP server, manages inbound and outbound
  sockets, frames newline-delimited JSON, and does **multi-hop forwarding**: a
  verified envelope is re-broadcast to all other peers, with a `seenForwarded`
  ring buffer (`FORWARD_SEEN_CAP = 1000`) breaking loops. It also keeps a
  `recentEnvelopes` buffer for **catch-up on discovery** — a newly discovered
  peer is sent the messages it missed.
- **`DiscoveryService`** wraps `react-native-zeroconf` for mDNS/Bonjour: it
  publishes the local node and resolves peers to `ip:port`. The matching
  Bonjour service strings live in `app.json`.
- **`MultipeerService`** wraps the `mesh-multipeer` native module. Service type
  `meshgemma-mc`. It also does catch-up when an MPC connection (re)establishes.
- **`BleBeaconService`** wraps `mesh-ble-peripheral` to advertise a tiny
  identity payload (`{ pubKey, shortId }`) on a fixed service UUID. **No data
  is exchanged over BLE** — it is presence-only. `BleMeshService` is the
  central-side scanner; `startAdvertising` is intentionally a no-op (peripheral
  advertising is handled by the native module instead).

---

## The signed wire format

Everything that crosses the mesh is a `SignedEnvelope`, defined and produced in
**`src/services/CryptoService.ts`**:

```ts
type SignedEnvelope<T> = {
  v: 1;
  pubKey: string;   // sender's Ed25519 public key, base64
  lamport: number;  // Lamport logical clock
  ts: number;       // wall-clock ms
  payload: T;        // InnerMessage (INCIDENT | CHAT | PING | LOCATION | CATCHUP)
  sig: string;       // Ed25519 signature, base64
};
```

- **Identity** — `tweetnacl` Ed25519 keypair, generated on first launch and
  persisted in AsyncStorage (`@meshgemma:identity:v1`). The `shortId` is the
  first 8 chars of the base64 public key.
- **Canonicalization** — `canonicalize()` is a recursive sorted-key serializer.
  It produces byte-identical output for semantically-equal payloads regardless
  of key insertion order, so two phones always sign/verify the same bytes.
  Both `sign()` and `verify()` run the payload through it.
- **Signing** — `sign()` increments the Lamport clock, builds the envelope
  base, canonicalizes it, and signs with `nacl.sign.detached`.
- **Verifying** — `verify()` re-canonicalizes and checks the signature with
  `nacl.sign.detached.verify`, advancing the local Lamport clock on success.
- **Lamport crash-safety** — on boot the in-memory clock jumps
  `LAMPORT_BOOT_RESERVE = 1000` ahead of the last persisted value, so a crash
  that loses an unflushed write window can never make the node reuse a
  `(pubKey, lamport)` pair another peer has already seen. Persistence is a
  trailing-edge debounce so signing never blocks on I/O.

`InnerMessage` (the payload union) and the `WireEnvelope` alias are declared in
`TcpMeshService.ts`.

---

## On-device Gemma 4

**`src/services/LocalLlamaService.ts`** is the on-device AI path.

- **Model** — Gemma 4 E2B at IQ2_M quantization
  (`gemma-4-E2B-it-UD-IQ2_M.gguf`, ~2.29 GB) plus the vision projector
  (`mmproj-F16.gguf`, ~986 MB). ~3.28 GB total, downloaded once via
  `expo-file-system` resumable downloads with disk-space pre-checks and
  two-stage progress reporting.
- **Runtime** — `llama.rn` 0.12 (a React Native binding of llama.cpp).
  `initLlama()` loads the model with `n_ctx: 4096` and `use_mlock: true`. On
  iOS, **all layers are offloaded to the Metal GPU** (`n_gpu_layers = 99`).
- **Vision** — after the text model loads, `initMultimodal()` attaches the
  `mmproj-F16` projector, setting `visionEnabled`. Image+text inference then
  runs by passing `media_paths` to `completion()` — the iOS `file://` URI is
  stripped/decoded first because llama.cpp's `fopen()` expects a native path.
  This is what powers on-device photo analysis in **LOCAL** mode.
- **Consumers** — `GemmaChatScreen.tsx` (the Analysis LPU tab) routes both
  text chat and photo analysis through here. `RadioCompressService.ts` calls
  it for local-mode compression.

A separate optional path, **`src/services/VisionAnalyzeService.ts`**, posts an
image to a `llama-server` running on a Mac (the "REMOTE" mode) for speed. The
same Gemma 4 E2B model can run either on-device or Mac-hosted.

---

## The offline map

**`src/services/MapTileService.ts`** drives MapLibre's native `OfflineManager`.
It builds a MapLibre style for OpenStreetMap raster tiles, materializes it to a
file, and `createPack()` pre-downloads tiles for a bounded area into the SDK's
SQLite store. Cached tiles are reused by live renders, so the **Tactical Map**
tab (`OfflineMapScreen.tsx`) renders with no connectivity once an area is
preloaded. Tile-count estimation uses standard slippy-map math
(`tileRangeForZoom` / `latToTileY`).

---

## The radio-compression service

**`src/services/RadioCompressService.ts`** + **`src/components/RadioPanel.tsx`**.

`compressFeed()` takes up to 50 incidents (plus optional chat messages),
summarizes them, and prompts Gemma — on-device or Mac-host per the LPU toggle —
to emit a strict JSON payload of **≤200 bytes** for a low-bandwidth radio
uplink. It extracts JSON from the model output (tolerating markdown fences),
validates and re-stringifies it for a stable byte count, and does **one
re-prompt** if the first attempt is malformed or oversized.

`estimateLoraAirtimeMs()` produces an on-screen LoRa-airtime estimate from a
static formula. The **TRANSMIT** button in `RadioPanel.tsx` is an
**honestly-labeled simulated animation** — there is no LoRa hardware in this
build, and a persistent banner says so. The compression itself is real Gemma
inference.

---

## The two custom Swift Expo modules

Under `modules/`, both autolinked via their `expo-module.config.json` and
referenced from `package.json` as `file:./modules/<name>`. They require a
custom dev build (`expo prebuild`); Expo Go cannot load them.

- **`mesh-multipeer`** — `modules/mesh-multipeer/ios/MeshMultipeerModule.swift`
  wraps Apple's `MultipeerConnectivity` framework. It exposes `start`/`stop`/
  `send`/`invitePeer`/`getConnectedPeers` and emits peer-found/lost/state and
  data-received events. The TypeScript wrapper (`src/index.ts`) uses
  `requireOptionalNativeModule` so the app degrades to a safe no-op when the
  module is absent.
- **`mesh-ble-peripheral`** —
  `modules/mesh-ble-peripheral/ios/MeshBlePeripheralModule.swift` wraps
  `CBPeripheralManager` to advertise a single read-only identity
  characteristic over BLE. Same optional-module pattern: missing module → all
  methods are no-ops.

Both JS wrappers being optional is why the rest of the app still boots on a
build where the native modules are misconfigured.

---

## Boot & state flow

`App.tsx` wraps everything in `AppProvider` (`src/context/AppContext.tsx`).
On mount, `AppContext` initializes the crypto identity, starts the TCP server,
mDNS discovery, the MultipeerConnectivity transport, and the BLE beacon, then
subscribes a single envelope handler that **verifies → dedups → delivers** to
feed / chat / location state. Persisted keys: identity, Lamport clock, feed,
chat history, and the delivery-dedup set (see DEMO_RUNBOOK.md "What's
persisted").
