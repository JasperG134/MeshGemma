import naclUtil from 'tweetnacl-util';
import { meshBlePeripheral } from 'mesh-ble-peripheral';

// 128-bit UUIDs supplied by the mesh-ble-peripheral module's README.
// These must be stable across the fleet so phones recognize each other.
const SERVICE_UUID = '8E7B0D2C-5A4F-4F1E-9F7B-1E6D0F2B3A4C';
const CHARACTERISTIC_UUID = 'D2A1B4F6-8C7E-4B5A-9D3F-2E1A6C5B4D8F';

class BleBeaconService {
  private started = false;
  private subs: Array<() => void> = [];

  isAvailable(): boolean {
    return meshBlePeripheral.isAvailable();
  }

  async start(opts: { pubKey: string; shortId: string }): Promise<void> {
    if (!meshBlePeripheral.isAvailable()) return;
    if (this.started) return;

    // Payload exposed via the read-only identity characteristic. Tiny — just
    // pubKey + shortId base64 of UTF-8 JSON. Centrals connect, read once,
    // disconnect — that's it.
    const payloadJson = JSON.stringify({ pubKey: opts.pubKey, shortId: opts.shortId });
    const payloadB64 = naclUtil.encodeBase64(naclUtil.decodeUTF8(payloadJson));

    // BLE adverts are size-constrained: keep localName short.
    const localName = `MG${opts.shortId.slice(0, 6)}`;

    try {
      await meshBlePeripheral.start({
        serviceUuid: SERVICE_UUID,
        characteristicUuid: CHARACTERISTIC_UUID,
        localName,
        payloadBase64: payloadB64,
      });
      this.started = true;
    } catch (e) {
      console.warn('[BleBeaconService] start failed:', e);
      return;
    }

    this.subs.push(
      meshBlePeripheral.addListener('onStateChange', (e) => {
        if (e.state === 'unauthorized' || e.state === 'unsupported') {
          console.warn('[BleBeaconService] BLE unavailable:', e.state, e.message);
        }
      }),
    );
    this.subs.push(
      meshBlePeripheral.addListener('onError', (e) => {
        console.warn('[BleBeaconService] error:', e.message);
      }),
    );
  }

  async stop(): Promise<void> {
    this.subs.forEach((u) => {
      try { u(); } catch { /* best-effort */ }
    });
    this.subs = [];
    this.started = false;
    if (meshBlePeripheral.isAvailable()) {
      try {
        await meshBlePeripheral.stop();
      } catch (e) {
        console.warn('[BleBeaconService] stop failed:', e);
      }
    }
  }

  // Service UUID exposed so the central scanner can filter by it.
  getServiceUuid(): string {
    return SERVICE_UUID;
  }
}

export const bleBeaconService = new BleBeaconService();
