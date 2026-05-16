# mesh-multipeer

Local Expo module that wraps Apple's **MultipeerConnectivity** framework so two iOS devices can talk peer-to-peer over Bluetooth + Wi-Fi Direct with no router and no internet.

## What it does

- Advertises and browses simultaneously under a single Bonjour service type (default `meshgemma-mc`).
- Auto-invites every discovered peer into a single shared `MCSession` with `.required` encryption (TLS).
- Exchanges arbitrary binary payloads, base64-wrapped at the JS boundary.

## Wire format

This module is **transport only**. The integrator is expected to wrap an application-layer envelope (typically a UTF-8 JSON object) and base64-encode the bytes before calling `send`. On the receiving side, base64-decode `payloadBase64` and parse your envelope. The module never inspects or mutates the payload.

## Events

- `onStateChange` — `{ state: 'started' | 'stopped' | 'error'; message?: string }`
- `onPeerFound` — `{ name: string; info: Record<string, string> }`
- `onPeerLost` — `{ name: string }`
- `onPeerStateChange` — `{ name: string; state: 'connecting' | 'connected' | 'notConnected' }`
- `onDataReceived` — `{ from: string; payloadBase64: string }`

## Example

```ts
import { meshMultipeer } from 'mesh-multipeer';

const off = meshMultipeer.addListener('onDataReceived', (e) => console.log('rx', e.from, e.payloadBase64));
await meshMultipeer.start({ displayName: 'phone-A', discoveryInfo: { pubKey: 'abc' } });
await meshMultipeer.send(btoa('hello'));            // broadcast to all connected peers
await meshMultipeer.send(btoa('hi B'), ['phone-B']); // unicast
// ...later:
off(); await meshMultipeer.stop();
```
