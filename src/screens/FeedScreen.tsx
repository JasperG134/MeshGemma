import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Animated, Alert, ActionSheetIOS } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '../theme/colors';
import { Incident, MOCK_USER } from '../services/MockDatabase';
import { useAppContext } from '../context/AppContext';
import { locationService, Coords } from '../services/LocationService';
import { resizeForMesh } from '../utils/imageResize';
import PhotoIncidentCard from '../components/PhotoIncidentCard';

export default function FeedScreen() {
  const { feed, addIncident, identity, peers, ready, clearFeed, displayName, aiComputeMode, serverIp, setVisionAnalysis } = useAppContext();

  const confirmClearFeed = () => {
    Alert.alert(
      'Clear local feed?',
      'Removes all incidents (yours + received). Cannot be undone. Other peers keep their copies.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => { clearFeed().catch(() => {}); } },
      ],
    );
  };
  const [input, setInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [sosCooldown, setSosCooldown] = useState(false);
  const [posting, setPosting] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<{ base64: string; bytes: number } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);

  const friendlyName = displayName.trim();
  const authorLabel = friendlyName.length > 0
    ? friendlyName
    : (identity ? `NODE-${identity.shortId}` : MOCK_USER);
  const peerCount = peers.length;

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const sosPulseAnim = useRef(new Animated.Value(1)).current;
  const sosTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ])
    );
    pulseLoop.start();

    const sosLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sosPulseAnim, {
          toValue: 1.15,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(sosPulseAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        })
      ])
    );
    sosLoop.start();

    return () => {
      pulseLoop.stop();
      sosLoop.stop();
      if (sosTimeoutRef.current) clearTimeout(sosTimeoutRef.current);
    };
  }, [pulseAnim, sosPulseAnim]);

  const captureCoords = async (): Promise<Coords | null> => {
    try {
      const fresh = await locationService.getCurrentCoords(6000);
      if (fresh) return fresh;
    } catch (e) {
      console.warn('GPS denied or failed:', e);
    }
    return locationService.getLastKnown();
  };

  const pickFromLibrary = async () => {
    setPhotoErr(null);
    setPhotoBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setPhotoErr('Photo library permission denied.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const asset = res.assets[0];
      const out = await resizeForMesh(asset.uri);
      setPendingPhoto({ base64: out.base64, bytes: out.rawBytes });
    } catch (e: any) {
      console.warn('pickFromLibrary failed:', e);
      setPhotoErr(`Photo import failed: ${e?.message ?? 'unknown'}`);
    } finally {
      setPhotoBusy(false);
    }
  };

  const takePhoto = async () => {
    setPhotoErr(null);
    setPhotoBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setPhotoErr('Camera permission denied.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const asset = res.assets[0];
      const out = await resizeForMesh(asset.uri);
      setPendingPhoto({ base64: out.base64, bytes: out.rawBytes });
    } catch (e: any) {
      console.warn('takePhoto failed:', e);
      setPhotoErr(`Camera failed: ${e?.message ?? 'unknown'}`);
    } finally {
      setPhotoBusy(false);
    }
  };

  const showPhotoSheet = () => {
    if (photoBusy) return;
    Haptics.selectionAsync();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Library'],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) takePhoto();
          if (idx === 2) pickFromLibrary();
        },
      );
    } else {
      Alert.alert('Attach photo', 'Choose a source', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take Photo', onPress: takePhoto },
        { text: 'Choose from Library', onPress: pickFromLibrary },
      ]);
    }
  };

  const clearPendingPhoto = () => {
    setPendingPhoto(null);
    setPhotoErr(null);
  };

  const handlePost = async () => {
    if (posting) return;
    if (!identity || ready !== 'ready') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!input.trim() || !locationInput.trim()) return;

    let type: Incident['type'] = 'general';
    const lowerInput = input.toLowerCase();
    // Order matters — more specific wins. Medical > hazard > supply > general.
    if (/(medic|blood|insulin|hurt|injur|wound|bleed)/.test(lowerInput)) {
      type = 'medical';
    } else if (/(fire|smoke|hazard|toxic|explos|gas leak|collapse)/.test(lowerInput)) {
      type = 'hazard';
    } else if (/(water|food|supply|battery|charger|baby|formula)/.test(lowerInput)) {
      type = 'supply';
    }

    setPosting(true);
    const coords = await captureCoords();
    const newIncident: Incident = {
      id: `${identity?.shortId ?? 'X'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      message: input,
      timestamp: Date.now(),
      author: authorLabel,
      locationName: locationInput,
      location: coords ? { lat: coords.lat, lng: coords.lng } : null,
      ...(pendingPhoto ? { imageB64: pendingPhoto.base64 } : {}),
    };
    try {
      await addIncident(newIncident);
    } finally {
      setPosting(false);
      setInput('');
      setLocationInput('');
      setPendingPhoto(null);
      setPhotoErr(null);
    }
  };

  const handleSOS = async () => {
    if (sosCooldown || posting) return;
    if (!identity || ready !== 'ready') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setPosting(true);
    const coords = await captureCoords();
    const sosIncident: Incident = {
      id: `${identity?.shortId ?? 'X'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'hazard',
      message: 'CRITICAL EMERGENCY: SOS Broadcast! Immediate help required.',
      timestamp: Date.now(),
      author: authorLabel,
      locationName: locationInput.trim() || 'CURRENT LOCATION',
      location: coords ? { lat: coords.lat, lng: coords.lng } : null,
    };
    try {
      await addIncident(sosIncident);
    } finally {
      setPosting(false);
      setSosCooldown(true);
      sosTimeoutRef.current = setTimeout(() => setSosCooldown(false), 10000);
    }
  };

  const getTagStyle = (type: string) => {
    switch (type) {
      case 'medical': return { borderColor: theme.colors.primary, color: theme.colors.primary, icon: 'medical' };
      case 'hazard': return { borderColor: theme.colors.danger, color: theme.colors.danger, icon: 'warning' };
      case 'supply': return { borderColor: theme.colors.success, color: theme.colors.success, icon: 'water' };
      default: return { borderColor: theme.colors.secondary, color: theme.colors.secondary, icon: 'information-circle' };
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>INCIDENT LOG // TACTICAL</Text>
          <View style={styles.meshStatus}>
            <Animated.View style={[styles.meshDot, { opacity: pulseAnim }]} />
            <Text style={styles.meshText}>
              {identity ? `${authorLabel} // PEERS: ${peerCount}` : 'IDENTITY BOOTING...'}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={confirmClearFeed} style={{ padding: 8 }} disabled={feed.length === 0}>
          <Ionicons
            name="trash-outline"
            size={22}
            color={feed.length === 0 ? theme.colors.textSecondary : theme.colors.danger}
          />
        </TouchableOpacity>
      </View>

      <FlatList
        data={feed}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={{color: theme.colors.textSecondary, textAlign: 'center', fontFamily: theme.typography.mono}}>AWAITING MESH DATA...</Text>}
        renderItem={({ item }) => {
          const style = getTagStyle(item.type);
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.authorRow}>
                  <Text style={styles.nodeId} numberOfLines={1}>
                    {item.author.startsWith('NODE-') ? item.author : `FROM: ${item.author.toUpperCase()}`}
                  </Text>
                </View>
                <View style={[styles.tag, { borderColor: style.borderColor }]}>
                  <Ionicons name={style.icon as any} size={10} color={style.color} style={{marginRight: 4}} />
                  <Text style={{ color: style.color, fontSize: 10, fontWeight: 'bold', fontFamily: theme.typography.mono }}>
                    {item.type.toUpperCase()}
                  </Text>
                </View>
              </View>
              
              <Text style={styles.message}>&gt; {item.message}</Text>

              {item.imageB64 && (
                <PhotoIncidentCard
                  incident={item}
                  aiComputeMode={aiComputeMode}
                  serverIp={serverIp}
                  onAnalysisComplete={(text) => setVisionAnalysis(item.id, text)}
                />
              )}

              <View style={styles.cardFooter}>
                <View style={styles.locationRow}>
                  <Ionicons name="location-outline" size={14} color={theme.colors.textSecondary} />
                  <Text style={styles.locationText}>{item.locationName.toUpperCase()}</Text>
                </View>
                <Text style={styles.time}>{new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</Text>
              </View>
              <View style={styles.signalBar}>
                <View style={[styles.signalFill, { width: `${((item.id.charCodeAt(0) || 0) + item.timestamp) % 40 + 60}%` }]} />
              </View>
            </View>
          );
        }}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {(pendingPhoto || photoErr) && (
          <View style={styles.photoStrip}>
            {pendingPhoto && (
              <View style={styles.photoChip}>
                <Ionicons
                  name="image-outline"
                  size={14}
                  color={theme.colors.success}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.photoChipText}>
                  PHOTO READY · {(pendingPhoto.bytes / 1024).toFixed(1)} KB
                </Text>
                <TouchableOpacity onPress={clearPendingPhoto} style={{ marginLeft: 8 }}>
                  <Ionicons name="close" size={14} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>
            )}
            {photoErr && <Text style={styles.photoErr}>{photoErr}</Text>}
          </View>
        )}
        <View style={styles.inputWrapper}>
          <TouchableOpacity
            onPress={handleSOS}
            activeOpacity={0.7}
            disabled={!identity || ready !== 'ready' || posting || sosCooldown}
          >
            <Animated.View
              style={[
                styles.sosButton,
                { transform: [{ scale: sosPulseAnim }] },
                (!identity || ready !== 'ready' || posting || sosCooldown) && { opacity: 0.4 },
              ]}
            >
              <Text style={styles.sosText}>SOS</Text>
            </Animated.View>
          </TouchableOpacity>
          <View style={styles.inputColumn}>
            <TextInput
              style={styles.locationInput}
              placeholder="LOC (e.g. 12 ELM ST)"
              placeholderTextColor={theme.colors.textSecondary}
              value={locationInput}
              onChangeText={setLocationInput}
            />
            <TextInput
              style={styles.messageInput}
              placeholder="REPORT INCIDENT..."
              placeholderTextColor={theme.colors.textSecondary}
              value={input}
              onChangeText={setInput}
              multiline
            />
          </View>
          <View style={styles.btnColumn}>
            <TouchableOpacity
              style={[
                styles.cameraBtn,
                (photoBusy || posting || !identity || ready !== 'ready') && { opacity: 0.5 },
              ]}
              onPress={showPhotoSheet}
              disabled={photoBusy || posting || !identity || ready !== 'ready'}
            >
              <Ionicons
                name={photoBusy ? 'hourglass-outline' : pendingPhoto ? 'checkmark' : 'camera'}
                size={18}
                color={theme.colors.background}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                (!input || !locationInput || posting || !identity || ready !== 'ready') && { opacity: 0.5 },
              ]}
              onPress={handlePost}
              disabled={!input || !locationInput || posting || !identity || ready !== 'ready'}
            >
              <Ionicons name={posting ? 'hourglass-outline' : 'send'} size={20} color={theme.colors.background} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    color: theme.colors.text,
    fontFamily: theme.typography.mono,
    letterSpacing: 1,
  },
  meshStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  meshDot: {
    width: 6,
    height: 6,
    backgroundColor: theme.colors.success,
    marginRight: 6,
  },
  meshText: {
    color: theme.colors.success,
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: theme.typography.mono,
    letterSpacing: 0.5,
  },
  settingsIcon: {
    padding: 8,
  },
  list: {
    padding: theme.spacing.m,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 0,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 10,
    padding: theme.spacing.m,
    marginBottom: theme.spacing.m,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.primary,
    shadowColor: theme.colors.background,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 0,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: 8,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nodeId: {
    color: theme.colors.text,
    fontWeight: '900',
    fontSize: 12,
    fontFamily: theme.typography.mono,
    letterSpacing: 2,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 2,
    backgroundColor: '#0A0A0A',
  },
  message: {
    color: theme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
    marginTop: 4,
    fontFamily: theme.typography.mono,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationText: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: 'bold',
    marginLeft: 4,
    fontFamily: theme.typography.mono,
  },
  time: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontFamily: theme.typography.mono,
  },
  signalBar: {
    height: 2,
    backgroundColor: theme.colors.border,
    marginTop: 10,
    width: '100%',
  },
  signalFill: {
    height: '100%',
    backgroundColor: theme.colors.success,
  },
  inputWrapper: {
    flexDirection: 'row',
    padding: theme.spacing.m,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    alignItems: 'center',
  },
  sosButton: {
    backgroundColor: '#FF0000',
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 2,
    borderColor: '#990000',
    shadowColor: '#FF0000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5,
  },
  sosText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 2,
    fontFamily: theme.typography.mono,
  },
  inputColumn: {
    flex: 1,
    marginRight: 10,
  },
  locationInput: {
    backgroundColor: theme.colors.background,
    color: theme.colors.success,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
    fontSize: 12,
    fontFamily: theme.typography.mono,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  messageInput: {
    backgroundColor: theme.colors.background,
    color: theme.colors.success,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    maxHeight: 100,
    minHeight: 40,
    fontSize: 12,
    fontFamily: theme.typography.mono,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  button: {
    backgroundColor: theme.colors.success,
    borderRadius: 4,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnColumn: {
    flexDirection: 'column',
    gap: 6,
  },
  cameraBtn: {
    backgroundColor: theme.colors.secondary,
    borderRadius: 4,
    width: 48,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.m,
    paddingVertical: 6,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 6,
  },
  photoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: theme.colors.success,
    backgroundColor: theme.colors.background,
  },
  photoChipText: {
    color: theme.colors.success,
    fontFamily: theme.typography.mono,
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  photoErr: {
    color: theme.colors.danger,
    fontFamily: theme.typography.mono,
    fontSize: 10,
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 15, 12, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderRadius: 4,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.success,
  },
  modalTitle: {
    color: theme.colors.success,
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: theme.typography.mono,
  },
  modalSubtitle: {
    color: theme.colors.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
    fontSize: 11,
    fontFamily: theme.typography.mono,
  },
  modalInput: {
    backgroundColor: theme.colors.background,
    color: theme.colors.success,
    padding: 15,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 20,
    fontFamily: theme.typography.mono,
    fontWeight: 'bold',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalButton: {
    backgroundColor: theme.colors.success,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 4,
  },
  buttonText: {
    color: theme.colors.background,
    fontWeight: 'bold',
    fontFamily: theme.typography.mono,
  },
});