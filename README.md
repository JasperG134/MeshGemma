# MeshGemma

**An offline disaster-mesh app that runs Gemma 4 on the phone.**

When the internet, cell towers, and routers are all down, MeshGemma lets a group of iPhones form a peer-to-peer mesh over Bluetooth and WiFi-Direct, share signed incident reports and chat, navigate on a fully offline map, and run **Gemma 4 E2B on-device** to analyze photos, summarize the situation, and compress field reports for low-bandwidth radio uplink — all with zero connectivity.

---

## Features

- **Off-grid mesh networking** — phones discover each other and sync over two independent message transports, no router or internet required.
- **Signed, tamper-evident messages** — every incident, chat, and location update is an Ed25519-signed envelope with a Lamport clock; peers verify before they trust.
- **Multi-hop forwarding + catch-up** — envelopes relay through intermediate phones, and a phone that reconnects automatically receives the messages it missed.
- **On-device Gemma 4 E2B** — text *and* vision inference runs directly on the iPhone via `llama.rn` (llama.cpp) with Metal GPU offload. No server needed.
- **On-device photo analysis** — attach a JPEG to an incident and Gemma describes the scene, hazards, people, and urgency, locally on the device.
- **Offline tactical map** — MapLibre with pre-cached OpenStreetMap tiles; pan, locate, and see colored incident pins with no network.
- **Radio-uplink compression** — Gemma compresses up to 50 mesh records into a ≤200-byte JSON payload sized for a low-bandwidth government radio link.
- **Optional Mac-host mode** — for speed, the AI features can also point at a `llama-server` on a Mac instead of running on-device.

## App tour — five tabs

| Tab | What it does |
|---|---|
| **Mesh Scanner** | Live view of discovered peers (mDNS, MultipeerConnectivity, BLE proximity). |
| **Tactical Map** | Offline MapLibre map with preload-area caching and incident pins. |
| **Local Feed** | GPS-tagged, signed incident log with optional photo attachments. |
| **Analysis LPU** | Gemma chat + photo analysis (LOCAL on-device or REMOTE Mac host) + the radio-uplink panel. |
| **Chat** | Peer-to-peer signed text chat across the mesh. |

## Architecture overview

**Two message transports** feed one signed-envelope handler with per-transport dedup; a third BLE layer is presence-only:

1. **WiFi / TCP via mDNS** — phones on the same network auto-discover and exchange envelopes over a TCP server on port 4000. Highest throughput, multi-hop forwarding, catch-up on discovery.
2. **MultipeerConnectivity** — Apple's Bluetooth + WiFi-Direct framework. Truly off-grid: airplane mode on, Bluetooth on, no router. ~30 m range.
3. **BLE proximity beacon** — advertises the node's public key + short ID so phones light up on each other's radar. Presence-only (no data bus).

**Signed wire format** — `CryptoService` produces a `SignedEnvelope`: `{ v, pubKey, lamport, ts, payload, sig }`. Payloads are canonicalized with a recursive sorted-key serializer, signed with Ed25519 (`tweetnacl`), and stamped with a Lamport clock that jumps a safety reserve ahead on every boot to prevent counter reuse after a crash.

**On-device Gemma 4** — `LocalLlamaService` downloads the Gemma 4 E2B model (`gemma-4-E2B-it-UD-IQ2_M.gguf`, ~2.29 GB) plus its vision projector (`mmproj-F16.gguf`, ~986 MB), ~3.28 GB total. It runs inference through `llama.rn` (a React Native binding of llama.cpp), offloading all layers to the iOS Metal GPU. `initMultimodal()` loads the projector so the same context handles both text and image input.

**Offline map** — `MapTileService` drives MapLibre's native `OfflineManager`, pre-downloading OpenStreetMap raster tiles into the SDK's SQLite store so the map renders with no connectivity.

**Radio compression** — `RadioCompressService` asks Gemma (on-device or Mac-host) to crunch the incident feed into a strict ≤200-byte JSON payload, with a one-shot retry if the model returns malformed or oversized JSON.

For a deeper code tour, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Tech stack

- **Expo SDK 54**, **React Native 0.81**, **TypeScript** — iOS app.
- **`llama.rn` 0.12** (React Native binding of llama.cpp) — on-device Gemma 4 E2B, iOS Metal.
- **`@maplibre/maplibre-react-native`** — offline vector/raster maps.
- **`tweetnacl`** — Ed25519 signing.
- **`react-native-tcp-socket`** + **`react-native-zeroconf`** — TCP mesh + mDNS discovery.
- **`react-native-ble-plx`** — BLE scanning.
- Two **custom Swift Expo modules** under `modules/` — `mesh-multipeer` (MultipeerConnectivity) and `mesh-ble-peripheral` (BLE peripheral beacon).

## Setup & running

This is a custom Expo dev-client app — it does **not** run in Expo Go (the native mesh modules require a prebuild). Full step-by-step build and two-iPhone demo instructions are in **[DEMO_RUNBOOK.md](./DEMO_RUNBOOK.md)**.

Quick start:

```bash
npm install
npx expo prebuild --clean
cd ios && pod install && cd ..
npx expo run:ios --device
```

## Honest deferrals

We label what is real and what is simulated, on-camera and in the code:

- **Radio uplink TX is a simulated animation.** There is no LoRa hardware in this build. The radio panel genuinely uses Gemma to compress records to a ≤200-byte payload, but the "TRANSMIT" step is an honestly-labeled animation (`ENCODING → TX @ 868 MHz → ACK`) — a persistent banner says so. No real RF is transmitted.
- **The BLE transport is presence-only.** The BLE beacon makes phones visible to each other on the scanner radar; it is not used as a data bus. Mesh data flows over TCP/mDNS and MultipeerConnectivity.

## Hackathon tracks

- **Main track**
- **Impact: Global Resilience**
- **Special Technology: llama.cpp**

## Team

Jasper Groen and Guus Adema.

## License

[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
