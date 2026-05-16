# mesh-ble-peripheral

A local Expo module (iOS-only) that wraps `CBPeripheralManager` so this phone
can advertise itself over Bluetooth Low Energy as a peripheral.

## What it does

- Starts a BLE peripheral advertisement carrying a 128-bit service UUID and a
  short local name.
- Hosts a single read-only GATT characteristic whose value is a base64 payload
  supplied by JS (e.g. a short pubkey fingerprint).
- Emits state-change, start, stop, subscribe, and error events.

## What it does NOT do

- It does NOT scan for or read from remote peripherals. That's
  `react-native-ble-plx`'s job in this project. This module only fills the
  peripheral-mode gap.
- It does NOT implement GATT writes or notifications. `v1` is "broadcast my
  identity"; reads from a connected central are supported, writes/subscribes
  are out of scope.
- It does NOT support custom manufacturer data — iOS strips manufacturer data
  from advertising packets in the foreground, and entirely in the background.

## iOS advertising caveats

- **Local name length**: keep `localName` <= ~10 ASCII chars. iOS pushes longer
  names into the scan-response payload or truncates them; in the background
  the local name is dropped entirely.
- **Background mode**: when the app is backgrounded, iOS only advertises the
  service UUID (in the overflow area). Centrals MUST scan for the specific
  service UUID to discover the device — passive "any-BLE" scans won't see it.
  The host app must declare `bluetooth-peripheral` in `UIBackgroundModes` to
  keep advertising in the background.
- **Manufacturer data is stripped**: do not try to encode identity into
  manufacturer data. Put it in the characteristic value instead.
- **`CBAdvertisementDataIsConnectable` is ignored** by Apple — peripheral mode
  is always implicitly connectable when a service is registered.
- **Permission prompt**: the OS Bluetooth permission prompt fires the first
  time `CBPeripheralManager` is instantiated. This module instantiates it on
  the main thread inside `start()` so the prompt is presented cleanly.

## Picking UUIDs

Use random 128-bit UUIDs (RFC 4122 v4) for both the service and characteristic.
Don't reuse 16-bit assigned numbers from the Bluetooth SIG; collisions are real.

Generate locally with `uuidgen` (macOS) or `python -c 'import uuid;print(uuid.uuid4())'`.

## Usage

```ts
import { meshBlePeripheral } from 'mesh-ble-peripheral';

if (meshBlePeripheral.isAvailable()) {
  const off = meshBlePeripheral.addListener('onStateChange', (e) => {
    console.log('BLE state', e.state);
  });

  await meshBlePeripheral.start({
    serviceUuid: '8E7B0D2C-5A4F-4F1E-9F7B-1E6D0F2B3A4C',
    characteristicUuid: 'D2A1B4F6-8C7E-4B5A-9D3F-2E1A6C5B4D8F',
    localName: 'mesh-x7q',          // short!
    payloadBase64: btoa('hello'),    // your pubkey fingerprint, base64
  });

  // later:
  await meshBlePeripheral.updatePayload(btoa('updated'));
  await meshBlePeripheral.stop();
  off();
}
```

## Project integration

This is a local module under `modules/mesh-ble-peripheral/`. Expo
auto-discovers it via `expo-module.config.json`. No `app.json` plugin entry is
needed.

The Bluetooth Info.plist strings (`NSBluetoothAlwaysUsageDescription`,
`NSBluetoothPeripheralUsageDescription`) are already declared by the host app's
`react-native-ble-plx` plugin and `app.json.ios.infoPlist`, so this module
adds no new permission keys.
