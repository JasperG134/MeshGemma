import { BleManager, Device } from 'react-native-ble-plx';

// Lazy-init the BleManager. Constructing it eagerly at module import will
// throw if the native module isn't available (e.g. running in Expo Go before
// a custom dev client). Keep this service inert in that case so the rest of
// the app still boots.
let manager: BleManager | null = null;
let inert = false;

function getManager(): BleManager | null {
  if (inert) return null;
  if (manager) return manager;
  try {
    manager = new BleManager();
    return manager;
  } catch (e) {
    console.warn('[BleMeshService] BleManager unavailable; running inert:', e);
    inert = true;
    return null;
  }
}

class BleMeshService {
  private isScanning = false;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  public scanForNodes(onDeviceDiscovered: (device: Device) => void): void {
    if (this.isScanning) return;
    const m = getManager();
    if (!m) return;
    this.isScanning = true;

    try {
      m.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.warn('BLE scan error:', error);
          this.stopScanning();
          return;
        }
        if (device) onDeviceDiscovered(device);
      });
    } catch (e) {
      console.warn('BLE scan failed to start:', e);
      this.isScanning = false;
      return;
    }

    if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
    this.autoStopTimer = setTimeout(() => this.stopScanning(), 10000);
  }

  public stopScanning(): void {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    const m = getManager();
    if (m) {
      try {
        m.stopDeviceScan();
      } catch {
        // best-effort
      }
    }
    this.isScanning = false;
  }

  public async startAdvertising(): Promise<void> {
    // Real BLE peripheral advertising is not implemented in this build —
    // react-native-ble-plx does not ship a stable peripheral API on iOS,
    // and a custom native module is out of scope for the hackathon demo.
  }

  public isAvailable(): boolean {
    return getManager() !== null;
  }
}

export const bleMeshService = new BleMeshService();
