import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  PermissionsAndroid,
  Platform,
  TextInput,
  Alert,
  Animated,
  Easing,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Device } from 'react-native-ble-plx';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { bleMeshService } from '../services/BleMeshService';
import { tcpMeshService, WireEnvelope, InnerMessage } from '../services/TcpMeshService';
import { multipeerService } from '../services/MultipeerService';
import { cryptoService } from '../services/CryptoService';
import { DiscoveredPeer } from '../services/DiscoveryService';
import * as Network from 'expo-network';
import { theme } from '../theme/colors';
import { useAppContext } from '../context/AppContext';

const requestPermissions = async () => {
  if (Platform.OS === 'android') {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
  }
};

// Demo topology: chain A — C — B with C in the middle.
//   John (A) <-> Erik (C) <-> Jasper (B)
// Keyed off lowercased displayName. If self's name isn't in the map (e.g.
// any non-demo phone), no filtering is applied and all peers show.
const DEMO_TOPOLOGY: Record<string, string[]> = {
  john: ['erik'],
  erik: ['john', 'jasper'],
  jasper: ['erik'],
};

export default function MeshScannerScreen() {
  const { peers, identity, ready, mpcAvailable, mpcPeerCount, displayName, setDisplayName } = useAppContext();

  const allowedNames = DEMO_TOPOLOGY[displayName.trim().toLowerCase()];
  const filteredPeers = allowedNames
    ? peers.filter((p) => allowedNames.includes((p.displayName || '').trim().toLowerCase()))
    : peers;
  const displayedMpcCount = allowedNames
    ? Math.min(mpcPeerCount, allowedNames.length)
    : mpcPeerCount;
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);

  useEffect(() => { setNameInput(displayName); }, [displayName]);

  const saveDisplayName = async () => {
    await setDisplayName(nameInput.trim());
    setNameModalVisible(false);
  };
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [localIp, setLocalIp] = useState<string>('Loading...');
  const [manualIp, setManualIp] = useState<string>('');
  const [pinging, setPinging] = useState<string | null>(null);
  const radarAnim = useRef(new Animated.Value(0)).current;
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    requestPermissions();
    Network.getIpAddressAsync()
      .then((ip) => setLocalIp(ip))
      .catch(() => setLocalIp('Unknown'));
    return () => {
      bleMeshService.stopScanning();
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (scanning) {
      Animated.loop(
        Animated.timing(radarAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ).start();
    } else {
      radarAnim.setValue(0);
      radarAnim.stopAnimation();
    }
  }, [scanning, radarAnim]);

  const handleBleScan = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setScanning(true);
    setDevices([]);

    await bleMeshService.scanForNodes((device) => {
      setDevices((prev) => {
        if (!prev.find((d) => d.id === device.id)) return [...prev, device];
        return prev;
      });
    });

    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => setScanning(false), 10000);
  };

  const buildPing = (): WireEnvelope | null => {
    if (!identity) return null;
    const inner: InnerMessage = { kind: 'PING', data: { from: identity.shortId } };
    const env = cryptoService.sign<InnerMessage>(inner);
    // Pre-seed both transports' forwarding-dedup so a peer's relay of our own
    // PING never re-triggers our forward path. Mirrors AppContext's
    // incident/location/chat origination sites.
    tcpMeshService.rememberOutgoing(env);
    multipeerService.rememberOutgoing(env);
    return env;
  };

  const pingPeer = async (peer: DiscoveredPeer) => {
    if (!peer.ip) {
      Alert.alert('Peer not yet resolved', 'Waiting for IP from mDNS — try again in a second.');
      return;
    }
    const env = buildPing();
    if (!env) {
      Alert.alert('Identity not ready', 'Mesh boot still in progress.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPinging(peer.id);
    try {
      await tcpMeshService.sendTo(
        { ip: peer.ip, port: peer.port || tcpMeshService.getPort() },
        env,
      );
      Alert.alert('PING OK', `Reached ${peer.shortId ?? peer.name} @ ${peer.ip}`);
    } catch (e) {
      Alert.alert('PING FAILED', e instanceof Error ? e.message : String(e));
    } finally {
      setPinging(null);
    }
  };

  const pingManual = async () => {
    if (!manualIp.trim()) return;
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(manualIp)) {
      Alert.alert('Bad IP', 'IPv4 only, dotted-quad form.');
      return;
    }
    const env = buildPing();
    if (!env) {
      Alert.alert('Identity not ready');
      return;
    }
    setPinging(`manual:${manualIp}`);
    try {
      await tcpMeshService.sendTo({ ip: manualIp }, env);
      Alert.alert('PING OK', `Reached ${manualIp}`);
    } catch (e) {
      Alert.alert('PING FAILED', e instanceof Error ? e.message : String(e));
    } finally {
      setPinging(null);
    }
  };

  const renderPeer = ({ item }: { item: DiscoveredPeer }) => {
    const busy = pinging === item.id;
    const resolved = !!item.ip;
    return (
      <TouchableOpacity
        style={[styles.peerCard, busy && { opacity: 0.6 }]}
        onPress={() => pingPeer(item)}
        disabled={busy}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.peerName} numberOfLines={1}>
            {(() => {
              const node = `NODE-${item.shortId ?? item.name.slice(-8).toUpperCase()}`;
              return item.displayName && item.displayName.length > 0
                ? `${node} (${item.displayName})`
                : node;
            })()}
          </Text>
          <Text style={styles.peerMeta}>
            {resolved ? `${item.ip}:${item.port || 4000}` : 'RESOLVING...'}
          </Text>
        </View>
        <Ionicons
          name={busy ? 'hourglass-outline' : 'paper-plane-outline'}
          size={18}
          color={resolved ? theme.colors.success : theme.colors.textSecondary}
        />
      </TouchableOpacity>
    );
  };

  const renderBleDevice = ({ item }: { item: Device }) => (
    <View style={styles.deviceCard}>
      <View>
        <Text style={styles.deviceName}>{item.name || 'UNKNOWN DEVICE'}</Text>
        <Text style={styles.deviceId}>{item.id}</Text>
      </View>
      <Text style={styles.rssi}>[{item.rssi || 'N/A'}]</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="hardware-chip-outline" size={28} color={theme.colors.success} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.title}>LPU LINK LAYER</Text>
          <Text style={styles.subtitle}>
            {ready === 'ready' && identity
              ? (displayName.trim().length > 0
                  ? `NODE-${identity.shortId} (${displayName}) @ ${localIp}`
                  : `NODE-${identity.shortId} @ ${localIp}`)
              : 'BOOTING IDENTITY...'}
          </Text>
          <Text style={styles.subtitle}>
            {`WIFI:${filteredPeers.length}  ·  ${mpcAvailable ? `MPC:${displayedMpcCount}` : 'MPC:OFF'}  ·  BLE:BEACON`}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setNameModalVisible(true)} style={{ padding: 8 }}>
          <Ionicons name="person-circle-outline" size={26} color={theme.colors.success} />
        </TouchableOpacity>
      </View>

      <View style={styles.tcpSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="wifi-outline" size={20} color={theme.colors.text} style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>MDNS PEERS</Text>
          <Text style={styles.peerCount}>  ({filteredPeers.length})</Text>
        </View>

        {filteredPeers.length === 0 ? (
          <Text style={styles.emptyTextInline}>
            No peers yet. Make sure both phones are on the same WiFi/hotspot and the app is open.
          </Text>
        ) : (
          <FlatList
            data={filteredPeers}
            keyExtractor={(p) => p.id}
            renderItem={renderPeer}
            scrollEnabled={false}
          />
        )}

        <Text style={styles.manualLabel}>MANUAL FALLBACK</Text>
        <View style={styles.manualRow}>
          <TextInput
            style={styles.input}
            placeholder="e.g. 192.168.1.42"
            placeholderTextColor={theme.colors.textSecondary}
            value={manualIp}
            onChangeText={setManualIp}
            keyboardType="numbers-and-punctuation"
          />
          <TouchableOpacity
            style={[styles.sendButton, !!pinging && styles.scanningButton]}
            onPress={pingManual}
            disabled={!!pinging}
          >
            <Ionicons name="paper-plane" size={16} color={theme.colors.background} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.sectionHeader}>
        <Ionicons name="bluetooth-outline" size={20} color={theme.colors.text} style={{ marginRight: 8 }} />
        <Text style={styles.sectionTitle}>BLE PROXIMITY (SCAN-ONLY)</Text>
      </View>

      <View style={styles.radarContainer}>
        {scanning && (
          <Animated.View
            style={[
              styles.radarRing,
              {
                transform: [
                  { scale: radarAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2] }) },
                ],
                opacity: radarAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              },
            ]}
          />
        )}
        <TouchableOpacity
          style={[styles.scanButton, scanning && styles.scanningButton]}
          onPress={handleBleScan}
          disabled={scanning}
        >
          <Ionicons
            name="radio-outline"
            size={24}
            color={scanning ? theme.colors.textSecondary : theme.colors.background}
          />
          <Text style={[styles.scanButtonText, scanning && { color: theme.colors.textSecondary }]}>
            {scanning ? 'SCANNING' : 'INITIATE SCAN'}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={devices}
        keyExtractor={(item) => item.id}
        renderItem={renderBleDevice}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>BLE shows visible devices only — chat sync uses WiFi mDNS above.</Text>
        }
      />

      <Modal visible={nameModalVisible} animationType="slide" transparent={true} onRequestClose={() => setNameModalVisible(false)}>
        <View style={nameModal.overlay}>
          <View style={nameModal.box}>
            <View style={nameModal.titleRow}>
              <Ionicons name="person-circle-outline" size={22} color={theme.colors.success} style={{ marginRight: 8 }} />
              <Text style={nameModal.title}>SET CALL SIGN</Text>
            </View>
            <Text style={nameModal.subtitle}>
              How peers see you in the chat and feed. Leave empty to use the auto-generated NODE-{identity?.shortId ?? '????????'}. Max 24 chars.
            </Text>
            <TextInput
              style={nameModal.input}
              value={nameInput}
              onChangeText={(t) => setNameInput(t.slice(0, 24))}
              placeholder="e.g. Alex"
              placeholderTextColor="#444"
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={24}
            />
            <View style={nameModal.actions}>
              <TouchableOpacity
                style={[nameModal.btn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.border }]}
                onPress={() => setNameModalVisible(false)}
              >
                <Text style={[nameModal.btnText, { color: theme.colors.textSecondary }]}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={nameModal.btn} onPress={saveDisplayName}>
                <Text style={nameModal.btnText}>SAVE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: theme.colors.surface,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    color: theme.colors.success,
    fontFamily: theme.typography.mono,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.colors.text,
    fontFamily: theme.typography.mono,
    letterSpacing: 1,
  },
  peerCount: {
    color: theme.colors.success,
    fontFamily: theme.typography.mono,
    fontSize: 12,
  },
  tcpSection: {
    backgroundColor: theme.colors.surface,
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  peerCard: {
    backgroundColor: '#050A05',
    padding: 12,
    borderRadius: 4,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.success,
    flexDirection: 'row',
    alignItems: 'center',
  },
  peerName: {
    color: theme.colors.text,
    fontFamily: theme.typography.mono,
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  peerMeta: {
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 10,
    marginTop: 2,
  },
  emptyTextInline: {
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 11,
    marginBottom: 12,
    lineHeight: 16,
  },
  manualLabel: {
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 6,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#050A05',
    color: theme.colors.success,
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.success,
    fontFamily: theme.typography.mono,
    fontSize: 14,
  },
  sendButton: {
    backgroundColor: theme.colors.primary,
    padding: 12,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 44,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 16,
  },
  radarContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 120,
    marginBottom: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  radarRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(249, 115, 22, 0.1)',
  },
  scanButton: {
    backgroundColor: theme.colors.primary,
    padding: 16,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    width: 200,
    flexDirection: 'row',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },
  scanningButton: {
    backgroundColor: theme.colors.surfaceHighlight,
    shadowOpacity: 0,
    elevation: 0,
  },
  scanButtonText: {
    color: theme.colors.background,
    fontSize: 14,
    fontWeight: '900',
    fontFamily: theme.typography.mono,
    letterSpacing: 1,
    marginLeft: 8,
  },
  list: {
    paddingBottom: 20,
  },
  deviceCard: {
    backgroundColor: '#051005',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.primary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deviceName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.colors.text,
    fontFamily: theme.typography.mono,
  },
  deviceId: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 4,
    fontFamily: theme.typography.mono,
  },
  rssi: {
    fontSize: 14,
    color: theme.colors.success,
    fontWeight: 'bold',
    fontFamily: theme.typography.mono,
  },
  emptyText: {
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 32,
    fontFamily: theme.typography.mono,
    fontSize: 11,
  },
});

const nameModal = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 15, 12, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  box: {
    backgroundColor: theme.colors.surface,
    borderRadius: 4,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.success,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: {
    color: theme.colors.success,
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: theme.typography.mono,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    marginBottom: 20,
    lineHeight: 18,
    fontSize: 11,
    fontFamily: theme.typography.mono,
  },
  input: {
    backgroundColor: theme.colors.background,
    color: theme.colors.success,
    padding: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 20,
    fontFamily: theme.typography.mono,
    fontWeight: 'bold',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btn: {
    backgroundColor: theme.colors.success,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 4,
  },
  btnText: {
    color: theme.colors.background,
    fontWeight: 'bold',
    fontFamily: theme.typography.mono,
  },
});
