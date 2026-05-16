# MeshGemma — 2-iPhone Demo Runbook

This guide takes the codebase from `git clone` to **two iPhones running the app**, syncing incidents over WiFi, with optional Gemma chat (on-device or via a Mac host).

---

## What you need

- A Mac with **Xcode 15+** installed (the full app, not just CLI tools).
- **Two iPhones** (iOS 15.1+). They must both belong to your free Apple ID's "Personal Team" (max 3 devices).
- A **free Apple ID** signed into Xcode → Settings → Accounts.
- For **off-grid** demo: nothing — MultipeerConnectivity uses Bluetooth + WiFi-Direct, no router needed (~30 m line-of-sight).
- For **WiFi mesh** demo: a **shared WiFi network** OR one phone's mobile hotspot the other phone joins.
- (Optional) A llama.cpp server running on the Mac for "remote Gemma" mode.

## Three transports, layered

This build has two message transports feeding the signed-envelope handler, plus a presence-only BLE beacon:

1. **WiFi/TCP via mDNS** — phones on the same router auto-discover each other and exchange envelopes via a TCP server on port 4000. Multi-hop forwarding + catchup-on-discovery. Best throughput.
2. **MultipeerConnectivity (off-grid)** — Apple's framework over Bluetooth + WiFi-Direct. No router needed. Catchup-on-connect. ~30 m range. **This is the airplane-mode-but-bluetooth-on demo.**
3. **BLE peripheral beacon** — advertises our pubkey + shortId so phones see each other in BLE proximity. Presence-only (no data exchange). Lights up the radar without WiFi.

Each transport runs its own dedup; envelopes received over multiple transports are applied exactly once.

> ⚠️ Free Apple Dev signing means the build **expires after 7 days**. Just re-run `expo run:ios --device` to refresh.

---

## 1. First-time setup

```bash
cd MeshGemma
npm install
sudo gem install cocoapods       # if you don't have pods already
npx expo prebuild --clean        # generates native ios/ and android/ projects
cd ios && pod install && cd ..
```

If `prebuild` warns about plugins — that's fine. The plugins it cares about (`react-native-ble-plx`, `expo-location`, `llama.rn`, `@maplibre/maplibre-react-native`, `expo-dev-client`, `expo-font`) are all in `app.json`.

---

## 2. Sign with your free Apple ID

1. Open `ios/meshgemma.xcworkspace` in Xcode.
2. Click the project in the sidebar → "Signing & Capabilities" tab.
3. Set **Team** to your personal team (the one labeled with your name + "Personal Team").
4. Bundle ID `com.ollamatesting.meshgemma` is fine, but **must be unique per Apple ID** — if Xcode complains, change it to `com.yourname.meshgemma` here AND in `app.json` (`expo.ios.bundleIdentifier`). Do not run prebuild again after editing app.json without committing — you'll lose the change in `Info.plist`.

---

## 3. Build to phone #1

1. Plug in iPhone #1 with a Lightning/USB-C cable.
2. Unlock it and tap "Trust" when prompted.
3. From the project root:

   ```bash
   npx expo run:ios --device
   ```

4. Pick the iPhone from the list. First build takes 5–10 minutes (Metro bundle + native compile).
5. On the phone: **Settings → General → VPN & Device Management → \[your Apple ID\] → Trust**. Without this, the app refuses to launch.
6. Open the app. You should see "BOOTING IDENTITY..." briefly, then "NODE-XXXXXXXX // PEERS: 0" in the Local Feed header.

---

## 4. Build to phone #2

Plug in phone #2, unplug phone #1. Repeat:

```bash
npx expo run:ios --device
```

Trust the cert on phone #2 the same way. Open the app. Both phones now have an identity.

---

## 5. Verify the mesh

The five tabs:
- **Mesh Scanner** — auto-discovered peers (mDNS), manual IP fallback, BLE scan (proximity-only)
- **Tactical Map** — MapLibre offline map with PRELOAD AREA + MY LOCATION
- **Local Feed** — incident log, GPS-tagged, signed
- **Analysis LPU** — Gemma chat (remote Mac host or on-device); the chip icon top-right opens the LPU IP modal
- **Chat** — peer-to-peer signed chat between phones

Test plan (in order — each step is more demanding than the last):

### 5a — On-grid (WiFi mDNS path)

1. Both phones on the **same WiFi** (or both joined to the same hotspot).
2. **Mesh Scanner** tab → within 5–15 seconds you'll see "WIFI:1" with the other phone under "MDNS PEERS".
   - iOS prompts for **local network** permission on first run. Tap "Allow" or peers stay invisible.
3. Tap the peer card → "PING OK" alert confirms signed TCP works.
4. **Local Feed** → location + message + send. Incident appears on the other phone within ~1 second, signed `NODE-XXXXXXXX`.
5. **Chat** tab → type a message. Other phone sees it instantly, color-coded.

### 5b — Off-grid (MultipeerConnectivity path)

This is the headline demo: airplane mode + Bluetooth on.

1. Both phones on iOS, MeshGemma open. **Settings → Bluetooth: ON.** WiFi can be ON or OFF.
2. iOS prompts on first run for **MPC permission** ("Local Network"). Tap "Allow".
3. Within 5–15 seconds, the Mesh Scanner header status line will show `WIFI:0 · MPC:1 · BLE:BEACON` — that 1 means MPC is off-grid connected.
4. Now turn off WiFi entirely on both phones (keep Bluetooth on). The MPC count stays.
5. **Local Feed** → post an incident. **It will arrive on the other phone over MPC.**
6. **Chat** tab → message. Same — over MPC, no router involved.
7. Catchup-on-MPC: close the app on B, post on A, reopen B. When the MPC connection re-establishes, B receives a catchup envelope from A and the missed messages appear.

### 5c — Multi-hop (3 phones, optional)

A↔B↔C topology where C is out of WiFi range of A but in range of B. Forwarding to both inbound and outbound peers means B relays for both directions. Dedup absorbs loops.

---

## 6. Verify the map

1. **Tactical Map** tab. The map should render with OpenStreetMap tiles.
2. Tap **"MY LOCATION"** (bottom-left). Allow location when prompted. Camera flies to your real position; a small blue dot marks you.
3. Pan to the area you want offline. Tap **"PRELOAD AREA"** → confirm. A progress overlay shows "Caching X / Y tiles…". Wait for it to finish.
4. Toggle airplane mode (or just kill WiFi). The cached tiles continue to render.
5. Post a new incident from the Feed tab — it shows up on the map of the other phone with the right colored pin (red=hazard, orange=medical, green=supply, yellow=general).

> The OSM tile server has a fair-use policy. Don't preload massive areas at zoom 18. The defaults (zoom 12–15 over a few km²) are fine.

---

## 7. Gemma AI chat

The **Analysis LPU** tab runs **Gemma 4 E2B** in one of two modes, chosen with
the toggle at the top of the tab: **LOCAL NEURAL ENGINE** (on-device) or
**REMOTE BASE STATION** (a Mac host). Both modes do text *and* vision.

### Option A — On-device (the headline AI demo)

1. **Analysis LPU** tab → tap the toggle to **LOCAL**.
2. Tap **DOWNLOAD**. This fetches **two files**, ~3.28 GB total:
   - `gemma-4-E2B-it-UD-IQ2_M.gguf` — the Gemma 4 E2B model weights (~2.29 GB)
   - `mmproj-F16.gguf` — the vision projector (~986 MB), required for on-device
     image analysis
   **Phone needs WiFi for this step** — it's a one-time download.
3. Once downloaded, type a query. Inference runs entirely on the iPhone via
   `llama.rn` (llama.cpp) with all layers offloaded to the Metal GPU
   (`n_gpu_layers=99`). Expect 10–60 seconds on iPhone 14+.

### Option B — Mac host (faster, optional)

For a snappier demo you can run the model on a Mac instead. On your Mac:

```bash
brew install llama.cpp
# download the Gemma 4 E2B GGUF + its mmproj sibling from Unsloth:
#   https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF
llama-server \
  -m gemma-4-E2B-it-UD-IQ2_M.gguf \
  --mmproj mmproj-F16.gguf \
  --host 0.0.0.0 --port 8080
```

On the phone:
1. **Analysis LPU** tab → tap the chip icon top-right → enter the Mac's IPv4 (`ifconfig | grep inet | grep 192`). Save.
2. Leave the toggle on **REMOTE BASE STATION**. Type a query. The LPU summarizes the incident feed using Gemma on your Mac.

---

## 7b. Photo analysis ("ANALYZE")

The **Local Feed** photo flow lets you attach a JPEG to an incident; tapping
**ANALYZE** runs Gemma 4's vision model over the image and renders the
description inline. This works in **both** modes:

- **LOCAL** — the image is passed to the on-device Gemma 4 E2B context via
  `llama.rn`'s `media_paths` API. The vision projector (`mmproj-F16.gguf`,
  downloaded alongside the model in step 7A) makes this fully on-device — no
  network, no Mac.
- **REMOTE** — the image is posted to a vision-capable `llama-server` on the
  Mac host (the same server from step 7B, started with `--mmproj`).

To use REMOTE photo analysis, start the Mac host exactly as in section 7
Option B (the `--mmproj mmproj-F16.gguf` flag is what enables vision).

On the phone:
1. **Analysis LPU** tab → pick **LOCAL** (on-device) or **REMOTE** (Mac host).
   For REMOTE, set the Mac's IPv4 via the chip icon.
2. **Local Feed** tab → tap the camera icon next to the message input → "Take Photo" or "Choose from Library".
3. Resize is automatic (320×240 JPEG q=70, target ≤ ~22 KB raw / ~30 KB base64).
4. Add a location + message and tap send. Photo syncs to the other phone over MPC/TCP.
5. Tap the photo card on either phone → **ANALYZE**. Gemma's report renders inline below the thumbnail (~3–8 s on Mac mode; longer on-device).

---

## 7c. Radio uplink panel ("Transmit to Gov", simulated)

The **Analysis LPU** tab has a **radio icon** in the header. Tapping it opens
the **RADIO UPLINK** panel, which:
- Reads up to 50 incidents from your local feed.
- Asks Gemma (LOCAL or REMOTE per your toggle) to compress them into a strict
  ≤200-byte JSON payload for low-bandwidth radio uplink.
- Shows raw bytes → compressed bytes → ratio at the top.
- One-shot retry if the model returns malformed or oversized JSON.
- The **TRANSMIT** button plays a 3-second simulated TX animation
  (`ENCODING → TX @ 868 MHz, SF7, BW125 → ACK 0x4F`) and copies the JSON to
  the clipboard.

There is **no LoRa hardware** in this build. A persistent yellow banner says
so, and the on-camera narration must match.

---

## 8. The story you can tell at demo time

> Two phones, no internet, no router. Bluetooth on. They auto-discover each other over Apple's MultipeerConnectivity (BT + WiFi-Direct), sign every message with on-device Ed25519 keys, and stay in sync. The tactical map works fully offline once tiles are cached. Optional Gemma summarization runs on a Mac host or directly on-device.

What this demo **does** show: real GPS, real signed mesh sync over two transports (WiFi/mDNS and MultipeerConnectivity off-grid) plus a BLE proximity beacon, real multi-hop forwarding, real catchup-on-reconnect, real offline maps, real AI.

What it **doesn't** show: BLE-as-data-bus (BLE is presence-only — see scanner radar). Real cross-network internet sync (we're explicitly an offline-first app).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| App won't open ("Untrusted Developer") | Settings → General → VPN & Device Management → trust your Apple ID |
| `pod install` fails | `cd ios && pod repo update && pod install` |
| "Local network" not prompted on iOS | Toggle the WiFi off+on, or reset privacy permissions in iOS Settings → General → Reset → Reset Location & Privacy |
| Peers never appear | Both phones on same SSID? Captive portal? AP isolation enabled? Try one phone's hotspot |
| `expo prebuild` fails | Delete `ios/` and `android/`, run again |
| Build expires after 7 days | Re-run `npx expo run:ios --device` |
| MapLibre crashes on launch | Ensure `@maplibre/maplibre-react-native` is in `app.json` plugins; re-run prebuild |
| Compile error mentions `react-native-zeroconf` | Native module needs autolinking — re-run `pod install`. If still broken, check that `react-native-zeroconf` doesn't require an Expo config plugin (none ships); a plain `pod install` should suffice |
| Compile error mentions `MeshMultipeerModule` or `MeshBlePeripheralModule` | Re-run `npx expo prebuild --clean && cd ios && pod install`. The local Expo modules under `modules/` are autolinked via their `expo-module.config.json` and need a clean prebuild after any change |
| MPC peer count stays 0 | iOS prompted "Local Network" — tap Allow. If denied, Settings → MeshGemma → Local Network → on. Both phones must have iOS 15.1+ |
| BLE beacon doesn't show in another phone's central scanner | Bluetooth on? On iOS the manufacturer-data is stripped — central scanners must filter by service UUID (`8E7B0D2C-...-3A4C`), not name |

---

## Native modules (local Expo modules)

This build ships two local Expo Modules under `modules/`:

- **`mesh-multipeer`** — Swift wrapper around Apple's `MultipeerConnectivity`. Off-grid iPhone↔iPhone transport.
- **`mesh-ble-peripheral`** — Swift wrapper around `CBPeripheralManager`. Identity beacon over BLE advertising.

Both are auto-discovered by Expo's autolinker (`expo-module.config.json` per module) — no plugin entries in `app.json` are needed beyond what's already present. The local modules are wired in via `package.json` `"file:./modules/<name>"` references; `npm install` symlinks them into `node_modules/`.

**These modules require a custom dev build.** Expo Go cannot load them — `expo prebuild` regenerates the `ios/` project with the Swift sources linked. If the modules are absent at runtime (e.g., misconfigured build), the JS wrappers fall back to safe no-ops via `requireOptionalNativeModule` so the rest of the app still works.

## What's persisted

- `@meshgemma:identity:v1` — your Ed25519 keypair. Survives app restarts.
- `@meshgemma:lamport:v1` — Lamport clock. On boot, in-memory clock jumps 1000 ahead of persisted value to make crash-induced reuse impossible.
- `@feed` — the synced incident log.
- `@meshgemma:chats:v1` — chat history (last 200 messages).
- `@meshgemma:seenMessages:v1` — delivery dedup set (cap 500).
- Map tiles — MapLibre native SQLite store (managed by `OfflineManager.createPack`).

To wipe everything, delete + reinstall the app. To rotate identity in code, call `cryptoService.rotate()` (no UI yet).
