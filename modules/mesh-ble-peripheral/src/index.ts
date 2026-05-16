import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Mirror of `CBManagerState` reported by iOS via the `onStateChange` event.
 */
export type BleManagerState =
  | 'unknown'
  | 'resetting'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'poweredOn';

/**
 * Events emitted by the native module. Keys MUST match the event names declared
 * in `MeshBlePeripheralModule.swift` (`Events(...)` block).
 */
export type MeshBlePeripheralEvents = {
  onStateChange: (e: { state: BleManagerState; message?: string }) => void;
  onAdvertisingStart: () => void;
  onAdvertisingStop: () => void;
  onSubscribe: (e: { centralId: string }) => void;
  onError: (e: { message: string }) => void;
};

export type StartOptions = {
  /** 128-bit UUID string. The integrator picks this. */
  serviceUuid: string;
  /** 128-bit UUID string for the single read-only identity characteristic. */
  characteristicUuid: string;
  /** Local name used in the BLE advertisement. <= 10 chars recommended on iOS. */
  localName: string;
  /** Initial characteristic payload as base64. Replaced via `updatePayload`. */
  payloadBase64: string;
};

/**
 * Native module surface as exported by Swift. This is a structural type — at
 * runtime we either get the real native object or `null`.
 */
type NativeMeshBlePeripheral = {
  start(
    serviceUuid: string,
    characteristicUuid: string,
    localName: string,
    payloadBase64: string
  ): Promise<void>;
  stop(): Promise<void>;
  updatePayload(payloadBase64: string): Promise<void>;
  isAdvertising(): Promise<boolean>;
  addListener<K extends keyof MeshBlePeripheralEvents>(
    event: K,
    handler: MeshBlePeripheralEvents[K]
  ): { remove(): void };
};

const nativeModule = requireOptionalNativeModule<NativeMeshBlePeripheral>(
  'MeshBlePeripheralModule'
);

/**
 * High-level wrapper. When the native module is missing (Android, web, or iOS
 * without the local module linked), every method becomes a safe no-op so the
 * caller can degrade gracefully without try/catch on every call site.
 */
// Expo's typed EventEmitter is strict about handler signatures (each must be
// `(...args: any[]) => void`). Our event handlers have specific argument shapes
// which TS doesn't consider assignable in strict mode. The loose alias below
// keeps runtime behavior identical while making `addListener` callable.
type LooseEmitter = {
  addListener: (event: string, handler: (...args: unknown[]) => void) => { remove(): void };
};

class MeshBlePeripheral {
  private readonly emitter: LooseEmitter | null;

  constructor(native: NativeMeshBlePeripheral | null) {
    this.emitter = native ? (native as unknown as LooseEmitter) : null;
  }

  /** True when the native module is linked and callable on the current platform. */
  isAvailable(): boolean {
    return nativeModule !== null;
  }

  async start(opts: StartOptions): Promise<void> {
    if (!nativeModule) {
      return;
    }
    await nativeModule.start(
      opts.serviceUuid,
      opts.characteristicUuid,
      opts.localName,
      opts.payloadBase64
    );
  }

  async stop(): Promise<void> {
    if (!nativeModule) {
      return;
    }
    await nativeModule.stop();
  }

  async updatePayload(payloadBase64: string): Promise<void> {
    if (!nativeModule) {
      return;
    }
    await nativeModule.updatePayload(payloadBase64);
  }

  async isAdvertising(): Promise<boolean> {
    if (!nativeModule) {
      return false;
    }
    return nativeModule.isAdvertising();
  }

  /**
   * Subscribe to a native event. Returns an unsubscribe function.
   * Safe no-op when the native module is unavailable.
   */
  addListener<K extends keyof MeshBlePeripheralEvents>(
    event: K,
    handler: MeshBlePeripheralEvents[K]
  ): () => void {
    if (!this.emitter) {
      return () => {
        /* no-op */
      };
    }
    const subscription = this.emitter.addListener(event, handler as (...args: unknown[]) => void);
    return () => {
      subscription.remove();
    };
  }
}

export const meshBlePeripheral: MeshBlePeripheral = new MeshBlePeripheral(nativeModule);
