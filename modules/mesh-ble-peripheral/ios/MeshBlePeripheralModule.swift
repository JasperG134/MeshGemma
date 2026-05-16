import ExpoModulesCore
import CoreBluetooth
import Foundation

// Event names (must match the TS EventsMap keys exactly).
private let onStateChangeEvent = "onStateChange"
private let onAdvertisingStartEvent = "onAdvertisingStart"
private let onAdvertisingStopEvent = "onAdvertisingStop"
private let onSubscribeEvent = "onSubscribe"
private let onErrorEvent = "onError"

/// Pending advertise request, captured if `start` is called before the manager is `.poweredOn`.
private struct PendingAdvertise {
  let serviceUuid: CBUUID
  let characteristicUuid: CBUUID
  let localName: String
  let payload: Data
}

/// CoreBluetooth peripheral-mode wrapper.
///
/// Scope: advertising-only. Hosts a single GATT service with one read-only
/// characteristic that returns the configured payload. We do NOT implement
/// writes, notifications, or remote-peripheral reads here — that's
/// `react-native-ble-plx`'s job on the central side.
///
/// iOS advertising caveats encoded here:
///  - `CBAdvertisementDataIsConnectable` is intentionally NOT set; iOS ignores it.
///  - Custom manufacturer data is NOT supported; iOS strips it from advertising
///    packets in the foreground. Identity must therefore live in the
///    characteristic value (read by a connected central) and/or in the
///    truncated `localName` for low-fidelity discovery.
///  - `localName` should be <= ~10 chars; longer names get pushed to the scan
///    response payload by iOS or truncated entirely when the app is backgrounded.
///  - In the background, only the service UUID is advertised (and only in the
///    overflow area); centrals must explicitly scan for the service UUID to see us.
public final class MeshBlePeripheralModule: Module {
  // Strong reference to the manager — required for delegate callbacks to fire.
  private var peripheralManager: CBPeripheralManager?
  private var delegateProxy: PeripheralDelegateProxy?

  private var currentService: CBMutableService?
  private var currentCharacteristic: CBMutableCharacteristic?
  private var currentPayload: Data = Data()

  private var pendingAdvertise: PendingAdvertise?
  private var advertising: Bool = false

  // MARK: - Module definition

  public func definition() -> ModuleDefinition {
    Name("MeshBlePeripheralModule")

    Events(
      onStateChangeEvent,
      onAdvertisingStartEvent,
      onAdvertisingStopEvent,
      onSubscribeEvent,
      onErrorEvent
    )

    AsyncFunction("start") { (
      serviceUuid: String,
      characteristicUuid: String,
      localName: String,
      payloadBase64: String
    ) -> Void in
      guard let serviceCbUuid = self.parseUuid(serviceUuid) else {
        throw NSError(
          domain: "MeshBlePeripheral",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Invalid serviceUuid: \(serviceUuid)"]
        )
      }
      guard let characteristicCbUuid = self.parseUuid(characteristicUuid) else {
        throw NSError(
          domain: "MeshBlePeripheral",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "Invalid characteristicUuid: \(characteristicUuid)"]
        )
      }
      let payloadData = Data(base64Encoded: payloadBase64) ?? Data()

      let pending = PendingAdvertise(
        serviceUuid: serviceCbUuid,
        characteristicUuid: characteristicCbUuid,
        localName: localName,
        payload: payloadData
      )
      self.currentPayload = payloadData
      self.pendingAdvertise = pending

      // Ensure manager creation runs on the main thread so the iOS Bluetooth
      // permission prompt is presented cleanly (not buried behind a deferred call).
      DispatchQueue.main.async {
        if self.peripheralManager == nil {
          let proxy = PeripheralDelegateProxy(owner: self)
          self.delegateProxy = proxy
          // Pass `queue: nil` -> delegate callbacks come on the main queue.
          self.peripheralManager = CBPeripheralManager(delegate: proxy, queue: nil)
        } else if self.peripheralManager?.state == .poweredOn {
          // Already on; flush immediately.
          self.flushPendingAdvertise()
        }
      }
    }

    AsyncFunction("stop") { () -> Void in
      DispatchQueue.main.async {
        self.teardown()
      }
    }

    AsyncFunction("updatePayload") { (payloadBase64: String) -> Void in
      let payloadData = Data(base64Encoded: payloadBase64) ?? Data()
      DispatchQueue.main.async {
        // We serve `currentPayload` dynamically from `didReceiveRead`, so the
        // value reflects on the next read without needing to mutate the
        // characteristic itself (which iOS prohibits once the service is added).
        self.currentPayload = payloadData
        // Update any pending advertise request too, so a not-yet-powered-on
        // manager picks up the new payload when it comes online.
        if let pending = self.pendingAdvertise {
          self.pendingAdvertise = PendingAdvertise(
            serviceUuid: pending.serviceUuid,
            characteristicUuid: pending.characteristicUuid,
            localName: pending.localName,
            payload: payloadData
          )
        }
      }
    }

    AsyncFunction("isAdvertising") { () -> Bool in
      return self.advertising
    }

    OnDestroy {
      DispatchQueue.main.async {
        self.teardown()
      }
    }
  }

  // MARK: - Private helpers

  fileprivate func emitOnMain(_ name: String, _ body: [String: Any?] = [:]) {
    if Thread.isMainThread {
      self.sendEvent(name, body)
    } else {
      DispatchQueue.main.async { [weak self] in
        self?.sendEvent(name, body)
      }
    }
  }

  private func parseUuid(_ raw: String) -> CBUUID? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return nil
    }
    // CBUUID(string:) raises an Objective-C exception (uncatchable from Swift)
    // on bad input. Validate strictly before calling.
    let hexChars = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
    if UUID(uuidString: trimmed) != nil {
      return CBUUID(string: trimmed)
    }
    // Also accept the BT-SIG short forms 0xXXXX (16-bit) and 0xXXXXXXXX (32-bit),
    // but ONLY when they're pure hex — otherwise CBUUID raises NSException.
    if (trimmed.count == 4 || trimmed.count == 8)
        && trimmed.unicodeScalars.allSatisfy({ hexChars.contains($0) }) {
      return CBUUID(string: trimmed)
    }
    return nil
  }

  private func teardown() {
    if let manager = self.peripheralManager {
      if manager.isAdvertising {
        manager.stopAdvertising()
      }
      manager.removeAllServices()
    }
    self.currentService = nil
    self.currentCharacteristic = nil
    self.pendingAdvertise = nil
    if self.advertising {
      self.advertising = false
      self.emitOnMain(onAdvertisingStopEvent)
    }
    // Drop manager + delegate; a future `start` recreates them and re-prompts
    // for permission only if the user previously denied.
    self.peripheralManager = nil
    self.delegateProxy = nil
  }

  fileprivate func flushPendingAdvertise() {
    guard let manager = self.peripheralManager else {
      return
    }
    guard manager.state == .poweredOn else {
      return
    }
    guard let pending = self.pendingAdvertise else {
      return
    }

    // Build a fresh service + characteristic. The characteristic is
    // read-only — no write properties, no notify.
    let characteristic = CBMutableCharacteristic(
      type: pending.characteristicUuid,
      properties: [.read],
      value: nil, // nil so iOS will call peripheralManager(_:didReceiveRead:) live;
                  // we serve `currentPayload` from there so updatePayload is reflected.
      permissions: [.readable]
    )
    let service = CBMutableService(type: pending.serviceUuid, primary: true)
    service.characteristics = [characteristic]

    self.currentCharacteristic = characteristic
    self.currentService = service
    self.currentPayload = pending.payload

    // Remove any previously added services to avoid duplicate-UUID errors.
    manager.removeAllServices()
    manager.add(service)

    // Service add is async — `peripheralManager(_:didAdd:error:)` fires next.
    // We defer startAdvertising until that callback to avoid a race where the
    // service isn't registered when a central tries to read.
  }

  fileprivate func startAdvertisingIfReady() {
    guard let manager = self.peripheralManager else {
      return
    }
    guard manager.state == .poweredOn else {
      return
    }
    guard let pending = self.pendingAdvertise else {
      return
    }
    if manager.isAdvertising {
      manager.stopAdvertising()
    }
    let advertisementData: [String: Any] = [
      CBAdvertisementDataServiceUUIDsKey: [pending.serviceUuid],
      CBAdvertisementDataLocalNameKey: pending.localName
    ]
    manager.startAdvertising(advertisementData)
  }

  // MARK: - Delegate forwards (called on main queue because we used `queue: nil`)

  fileprivate func handleStateUpdate(_ manager: CBPeripheralManager) {
    let stateString = MeshBlePeripheralModule.stateToString(manager.state)
    self.emitOnMain(onStateChangeEvent, ["state": stateString])

    switch manager.state {
    case .poweredOn:
      self.flushPendingAdvertise()
    case .poweredOff, .resetting, .unauthorized, .unsupported, .unknown:
      // Anything other than poweredOn means we are not advertising.
      if self.advertising {
        self.advertising = false
        self.emitOnMain(onAdvertisingStopEvent)
      }
    @unknown default:
      break
    }
  }

  fileprivate func handleServiceAdded(_ error: Error?) {
    if let error = error {
      self.emitOnMain(onErrorEvent, ["message": "service add failed: \(error.localizedDescription)"])
      return
    }
    self.startAdvertisingIfReady()
  }

  fileprivate func handleAdvertisingStarted(_ error: Error?) {
    if let error = error {
      self.advertising = false
      self.emitOnMain(onErrorEvent, ["message": "advertising start failed: \(error.localizedDescription)"])
      return
    }
    self.advertising = true
    self.emitOnMain(onAdvertisingStartEvent)
  }

  fileprivate func handleReadRequest(_ manager: CBPeripheralManager, request: CBATTRequest) {
    // Only respond for our characteristic.
    guard let characteristic = self.currentCharacteristic else {
      manager.respond(to: request, withResult: .attributeNotFound)
      return
    }
    guard request.characteristic.uuid == characteristic.uuid else {
      manager.respond(to: request, withResult: .attributeNotFound)
      return
    }
    let payload = self.currentPayload
    if request.offset > payload.count {
      manager.respond(to: request, withResult: .invalidOffset)
      return
    }
    request.value = payload.subdata(in: request.offset..<payload.count)
    manager.respond(to: request, withResult: .success)
  }

  fileprivate func handleSubscribe(centralId: String) {
    self.emitOnMain(onSubscribeEvent, ["centralId": centralId])
  }

  // MARK: - Static helpers

  fileprivate static func stateToString(_ state: CBManagerState) -> String {
    switch state {
    case .unknown: return "unknown"
    case .resetting: return "resetting"
    case .unsupported: return "unsupported"
    case .unauthorized: return "unauthorized"
    case .poweredOff: return "poweredOff"
    case .poweredOn: return "poweredOn"
    @unknown default: return "unknown"
    }
  }
}

/// Delegate proxy: keeps the Module class itself off the `NSObject` /
/// `CBPeripheralManagerDelegate` hierarchy (Expo's `Module` is a pure Swift
/// class) and routes callbacks back into the module via weak reference.
private final class PeripheralDelegateProxy: NSObject, CBPeripheralManagerDelegate {
  private weak var owner: MeshBlePeripheralModule?

  init(owner: MeshBlePeripheralModule) {
    self.owner = owner
    super.init()
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    self.owner?.handleStateUpdate(peripheral)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    self.owner?.handleServiceAdded(error)
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    self.owner?.handleAdvertisingStarted(error)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    self.owner?.handleReadRequest(peripheral, request: request)
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic
  ) {
    // We don't expose notify, but iOS still surfaces explicit subscribes in some
    // flows. Forward for debug visibility.
    self.owner?.handleSubscribe(centralId: central.identifier.uuidString)
  }
}
