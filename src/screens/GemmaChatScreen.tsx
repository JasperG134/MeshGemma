import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Animated, Modal, ActivityIndicator, Alert, ActionSheetIOS, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '../theme/colors';
import { useAppContext } from '../context/AppContext';
import { localLlamaService } from '../services/LocalLlamaService';
import { analyzePhoto, VisionUnavailableError } from '../services/VisionAnalyzeService';
import { resizeForMesh } from '../utils/imageResize';
import RadioPanel from '../components/RadioPanel';

type Message = {
  id: string;
  role: 'user' | 'gemma';
  text: string;
  timestamp: number;
  // Optional inline image (base64 JPEG) shown above the user's text bubble.
  imageB64?: string;
};

export default function GemmaChatScreen() {
  const { feed, chats, serverIp, setServerIp, aiComputeMode, setAiComputeMode } = useAppContext();
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [radioVisible, setRadioVisible] = useState(false);
  const [tempIp, setTempIp] = useState(serverIp);

  useEffect(() => { setTempIp(serverIp); }, [serverIp]);

  const confirmClearLpu = () => {
    if (messages.length <= 1) return;
    Alert.alert(
      'Clear LPU chat?',
      'Wipes the conversation with Gemma on this device. The model and your settings stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            setMessages([
              { id: '1', role: 'gemma', text: 'TACTICAL LPU ONLINE. AWAITING COMMAND QUERY.', timestamp: Date.now() },
            ]);
          },
        },
      ],
    );
  };

  const saveSettings = () => {
    setServerIp(tempIp);
    setSettingsVisible(false);
  };
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'gemma', text: 'TACTICAL LPU ONLINE. AWAITING COMMAND QUERY.', timestamp: Date.now() }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(-1);
  const [downloadStage, setDownloadStage] = useState<'model' | 'mmproj' | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasLocalModel, setHasLocalModel] = useState(false);
  // Pending photo waiting to be attached to the next outgoing user message.
  // `uri` is the local resized JPEG path — needed for on-device vision via
  // llama.rn's `media_paths`. `base64` is what REMOTE mode posts to llama-server.
  const [pendingPhoto, setPendingPhoto] = useState<{ base64: string; uri: string; bytes: number } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const checkModel = async () => {
      const exists = await localLlamaService.checkModelExists();
      setHasLocalModel(exists);
    };
    checkModel();
  }, [aiComputeMode]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0.2, duration: 500, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 500, useNativeDriver: true })
      ])
    );
    animation.start();

    return () => {
      animation.stop();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      localLlamaService.stopCompletion().catch(() => {});
    };
  }, []);

  const pickFromLibrary = async () => {
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photo library permission denied');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const out = await resizeForMesh(res.assets[0].uri);
      setPendingPhoto({ base64: out.base64, uri: out.uri, bytes: out.rawBytes });
    } catch (e: any) {
      console.warn('LPU pickFromLibrary failed:', e);
      Alert.alert('Photo import failed', e?.message ?? 'unknown');
    } finally {
      setPhotoBusy(false);
    }
  };

  const takePhoto = async () => {
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission denied');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const out = await resizeForMesh(res.assets[0].uri);
      setPendingPhoto({ base64: out.base64, uri: out.uri, bytes: out.rawBytes });
    } catch (e: any) {
      console.warn('LPU takePhoto failed:', e);
      Alert.alert('Camera failed', e?.message ?? 'unknown');
    } finally {
      setPhotoBusy(false);
    }
  };

  const showPhotoSheet = () => {
    if (photoBusy) return;
    Haptics.selectionAsync();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 },
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

  const sendMessage = async () => {
    // Allow sending with just a photo (no text) — Gemma falls back to "describe
    // the scene" inside VisionAnalyzeService.
    if (!input.trim() && !pendingPhoto) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: input || (pendingPhoto ? '(photo attached)' : ''),
      timestamp: Date.now(),
      ...(pendingPhoto ? { imageB64: pendingPhoto.base64 } : {}),
    };
    const photoForRequest = pendingPhoto;
    const questionForRequest = input;
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setPendingPhoto(null);
    setLoading(true);

    // Photo path: route through vision. REMOTE → llama-server with
    // image_data. LOCAL → llama.rn `media_paths` against the on-device
    // vision-capable Gemma + mmproj.
    if (photoForRequest) {
      try {
        let answer: string;
        if (aiComputeMode === 'remote') {
          const res = await analyzePhoto({
            serverIp,
            imageB64: photoForRequest.base64,
            question: questionForRequest,
          });
          answer = res.text;
        } else {
          // Build a vision prompt mirroring VisionAnalyzeService's free-form
          // path so LOCAL and REMOTE produce comparable answers.
          const trimmed = questionForRequest.trim();
          const userLine = trimmed.length > 0
            ? trimmed
            : 'Describe what you see in this photo. Be specific and only describe what is actually visible.';
          const visionPrompt = `<start_of_turn>user
You are Gemma, an on-device AI assistant inside MeshGemma — a peer-to-peer
mesh app used in disaster scenarios. The user has attached a photo and
wants concrete, actionable help. Answer briefly. Never invent details you
cannot see in the photo.

Question: ${userLine}<end_of_turn>
<start_of_turn>model
`;
          await localLlamaService.initModel();
          answer = await localLlamaService.completion(visionPrompt, undefined, {
            mediaPath: photoForRequest.uri,
          });
        }
        const gemmaMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'gemma',
          text: (answer || '').toUpperCase(),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, gemmaMsg]);
      } catch (e: any) {
        console.warn('LPU vision call failed:', e);
        const detail = e instanceof VisionUnavailableError
          ? e.message
          : (typeof e?.message === 'string' && e.message ? e.message : 'unknown error');
        const errorMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'gemma',
          text: `ERR: VISION FAILED. ${detail.toUpperCase()}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }
      return;
    }

    try {
      const feedItems = feed.slice(0, 10);
      const feedContext = feedItems.length > 0
        ? feedItems.map(f => `- [${f.type.toUpperCase()}] ${f.locationName}: ${f.message}`).join('\n')
        : '(no incidents in the local feed yet)';

      const contextPrompt = `<start_of_turn>user
You are Gemma, an on-device AI assistant inside MeshGemma — a peer-to-peer mesh app used when there is no internet, no cellular service, and no working emergency hotline. The user is most likely in a crisis or drill where standard "call 911 / call emergency services" advice is useless. Skip that boilerplate entirely.

Your job: give concrete, actionable help the user can do RIGHT NOW with what they have on hand.

How to answer:
- Medical emergencies (broken bones, bleeding, burns, choking, unconscious person, heatstroke, hypothermia, etc.): give clear first-aid steps in priority order. Improvise — splints from sticks/rolled magazines, tourniquets from belts, etc. Don't say "see a doctor" or "call an ambulance" as the answer; the user cannot. Mention infection risk and vital signs to monitor.
- Practical questions (navigation without GPS, translation, water purification, signaling for rescue, food safety, repairs, planning): just answer directly and usefully.
- When relevant, remind the user of MeshGemma's tools to get human help: tap SOS on the Local Feed tab to broadcast a signed emergency to nearby peers; the Chat tab sends messages to anyone in mesh range; pin your real GPS location so peers can find you.
- If the question relates to the local incident feed below, use it. Otherwise ignore the feed.
- Reply in the user's language (e.g. Dutch if they asked in Dutch). Be calm, brief, life-safety first. No disclaimers, no apologies, no "I'm sorry to hear that".

Local incident feed (signed reports from nearby peers, may be empty):
${feedContext}

User: ${userMsg.text}<end_of_turn>
<start_of_turn>model
`;

      let content = '';

      if (aiComputeMode === 'remote') {
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(`http://${serverIp}:8080/completion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: contextPrompt,
            n_predict: 512,
            temperature: 0.7,
            top_p: 0.9,
            stop: ["<end_of_turn>", "<start_of_turn>", "User:"]
          }),
          signal: controller.signal as any,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Failed to reach remote server at ${serverIp}`);
        }

        const textData = await response.text();
        let data;
        try {
          data = JSON.parse(textData);
        } catch (e) {
          throw new Error('Invalid JSON response from remote server');
        }
        content = typeof data?.content === 'string' ? data.content.trim() : '';
      } else {
        // LOCAL MODE
        try {
          await localLlamaService.initModel();
          content = await localLlamaService.completion(contextPrompt);
        } catch (e) {
          throw new Error('Local model completion failed');
        }
      }
      
      if (!content) {
        throw new Error('MALFORMED RESPONSE');
      }

      const gemmaMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'gemma',
        text: content.toUpperCase(),
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, gemmaMsg]);
    } catch (e: any) {
      if (e.name === 'AbortError') return; // Skip updating state if aborted
      console.error(e);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'gemma',
        text:
          e.message === 'MALFORMED RESPONSE'
            ? 'ERR: MALFORMED RESPONSE FROM LPU.'
            : aiComputeMode === 'remote'
              ? `ERR: LPU OFFLINE. CONNECTION TO ${serverIp}:8080 FAILED.`
              : 'ERR: LOCAL NEURAL ENGINE FAILED. SEE CONSOLE.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const [downloadError, setDownloadError] = useState<string | null>(null);

  const downloadLocalModel = async () => {
    setDownloadError(null);
    setIsDownloading(true);
    setDownloadStage('model');
    try {
      await localLlamaService.downloadModel((p) => {
        setDownloadStage(p.stage);
        setDownloadProgress(p.totalProgress);
      });
      setHasLocalModel(true);
    } catch (e: any) {
      console.error('Failed to download model', e);
      setDownloadError(e?.message || 'DOWNLOAD FAILED');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(-1);
      setDownloadStage(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="terminal" size={20} color={theme.colors.secondary} />
          <Text style={styles.title}>LPU // TACTICAL ADVISOR</Text>
          <TouchableOpacity
            onPress={() => setRadioVisible(true)}
            style={{ marginLeft: 'auto', padding: 6 }}
          >
            <Ionicons name="radio-outline" size={20} color={theme.colors.warning} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={confirmClearLpu}
            style={{ padding: 6 }}
            disabled={messages.length <= 1}
          >
            <Ionicons
              name="trash-outline"
              size={20}
              color={messages.length <= 1 ? theme.colors.textSecondary : theme.colors.danger}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSettingsVisible(true)}
            style={{ padding: 6 }}
          >
            <Ionicons name="hardware-chip-outline" size={20} color={theme.colors.secondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.modeToggleRow}>
          <TouchableOpacity 
            style={[styles.modeToggleBtn, aiComputeMode === 'remote' && styles.modeToggleBtnActive]} 
            onPress={() => setAiComputeMode('remote')}>
            <Text style={[styles.modeToggleText, aiComputeMode === 'remote' && styles.modeToggleTextActive]}>REMOTE BASE STATION</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.modeToggleBtn, aiComputeMode === 'local' && styles.modeToggleBtnActive]} 
            onPress={() => setAiComputeMode('local')}>
            <Text style={[styles.modeToggleText, aiComputeMode === 'local' && styles.modeToggleTextActive]}>LOCAL NEURAL ENGINE</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.statusRow}>
          <Animated.View style={[styles.statusDot, { opacity: blinkAnim }]} />
          <Text style={styles.subtitle}>DB RECORDS: {feed.length} | MODE: {aiComputeMode.toUpperCase()}</Text>
        </View>
      </View>

      {aiComputeMode === 'local' && !hasLocalModel ? (
        <View style={styles.downloadContainer}>
          <Ionicons name="hardware-chip" size={48} color={theme.colors.secondary} style={{ marginBottom: 16 }} />
          <Text style={styles.downloadText}>
            LOCAL VISION WEIGHTS REQUIRED (~3.3GB · GEMMA 4 E2B IQ2 + MMPROJ)
          </Text>
          {isDownloading ? (
            <>
              <Text style={[styles.downloadText, { fontSize: 11, marginBottom: 8 }]}>
                {downloadStage === 'mmproj'
                  ? 'STAGE 2/2 · DOWNLOADING VISION PROJECTOR (MMPROJ)'
                  : 'STAGE 1/2 · DOWNLOADING TEXT+VISION MODEL'}
              </Text>
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressBar, { width: `${downloadProgress * 100}%` }]} />
                <Text style={styles.progressText}>{(downloadProgress * 100).toFixed(1)}%</Text>
              </View>
            </>
          ) : (
            <TouchableOpacity style={styles.downloadBtn} onPress={downloadLocalModel}>
              <Text style={styles.downloadBtnText}>DOWNLOAD WEIGHTS</Text>
            </TouchableOpacity>
          )}
          {downloadError && (
            <Text style={{ color: theme.colors.danger, marginTop: 12, fontFamily: theme.typography.mono, textAlign: 'center' }}>
              {`ERR: ${downloadError.toUpperCase()}`}
            </Text>
          )}
        </View>
      ) : (
        <>
          <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item, index }) => (
          <View style={[styles.messageWrapper, item.role === 'user' ? styles.userWrapper : styles.gemmaWrapper]}>
            <View style={styles.messageHeader}>
              <Text style={[styles.messageRole, { color: item.role === 'user' ? theme.colors.textSecondary : theme.colors.secondary }]}>
                {item.role === 'user' ? 'CMD_OP' : 'SYS_LPU'}
              </Text>
              <Text style={styles.messageTime}>
                {new Date(item.timestamp).toLocaleTimeString([], {hour12: false})}
              </Text>
            </View>
            <View style={[styles.messageContent, item.role === 'user' ? styles.userContent : styles.gemmaContent]}>
              {item.role === 'gemma' && <Text style={styles.promptArrow}>&gt; </Text>}
              <View style={{ flexShrink: 1 }}>
                {item.imageB64 ? (
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${item.imageB64}` }}
                    style={styles.messageImage}
                    resizeMode="cover"
                  />
                ) : null}
                <Text style={[styles.text, { color: item.role === 'user' ? theme.colors.text : theme.colors.secondary }]}>
                  {item.text}
                </Text>
              </View>
              {index === messages.length - 1 && item.role === 'gemma' && !loading && (
                 <Animated.Text style={[{opacity: blinkAnim, color: theme.colors.secondary}, styles.text]}>{'_'}</Animated.Text>
              )}
            </View>
          </View>
        )}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {pendingPhoto && (
          <View style={styles.pendingPhotoStrip}>
            <Image
              source={{ uri: `data:image/jpeg;base64,${pendingPhoto.base64}` }}
              style={styles.pendingPhotoThumb}
              resizeMode="cover"
            />
            <Text style={styles.pendingPhotoText}>
              PHOTO READY · {(pendingPhoto.bytes / 1024).toFixed(1)} KB
            </Text>
            <TouchableOpacity onPress={() => setPendingPhoto(null)} style={{ paddingHorizontal: 8 }}>
              <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputContainer}>
          <TouchableOpacity
            style={[
              styles.photoBtn,
              (photoBusy || loading) && { opacity: 0.5 },
            ]}
            onPress={showPhotoSheet}
            disabled={photoBusy || loading}
          >
            <Ionicons
              name={photoBusy ? 'hourglass-outline' : pendingPhoto ? 'image' : 'camera'}
              size={18}
              color={theme.colors.background}
            />
          </TouchableOpacity>
          <Animated.Text style={[styles.inputPrefix, { opacity: input.length === 0 ? blinkAnim : 1 }]}>&gt;_</Animated.Text>
          <TextInput
            style={styles.input}
            placeholder={pendingPhoto ? 'OPTIONAL: ASK ABOUT THE PHOTO' : 'ENTER QUERY'}
            placeholderTextColor={theme.colors.textSecondary}
            value={input}
            onChangeText={setInput}
            multiline
            autoCapitalize="sentences"
          />
          <TouchableOpacity
            style={[styles.button, !input.trim() && !pendingPhoto && { opacity: 0.5 }]}
            onPress={sendMessage}
            disabled={loading || (!input.trim() && !pendingPhoto)}
          >
            {loading ? <ActivityIndicator color={theme.colors.background} size="small" /> : <Ionicons name="return-down-forward" size={20} color={theme.colors.background} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      </>
      )}

      <RadioPanel
        visible={radioVisible}
        onClose={() => setRadioVisible(false)}
        feed={feed}
        chats={chats.map((c) => ({
          text: c.text,
          ts: c.ts,
          shortId: c.shortId,
          displayName: c.displayName,
        }))}
        aiComputeMode={aiComputeMode}
        serverIp={serverIp}
      />

      <Modal visible={settingsVisible} animationType="slide" transparent={true} onRequestClose={() => setSettingsVisible(false)}>
        <View style={modalStyles.overlay}>
          <View style={modalStyles.content}>
            <View style={modalStyles.titleRow}>
              <Ionicons name="server-outline" size={22} color={theme.colors.success} style={{ marginRight: 8 }} />
              <Text style={modalStyles.title}>LPU UPLINK CONFIG</Text>
            </View>
            <Text style={modalStyles.subtitle}>
              IPv4 of the Mac/Linux host running `llama-server` on port 8080. Ignored in LOCAL mode.
            </Text>
            <TextInput
              style={modalStyles.input}
              value={tempIp}
              onChangeText={setTempIp}
              placeholder="192.168.1.5"
              placeholderTextColor="#333"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={modalStyles.actions}>
              <TouchableOpacity
                style={[modalStyles.button, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.border }]}
                onPress={() => setSettingsVisible(false)}
              >
                <Text style={[modalStyles.buttonText, { color: theme.colors.textSecondary }]}>ABORT</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.button, !tempIp.trim() && { opacity: 0.4 }]}
                onPress={saveSettings}
                disabled={!tempIp.trim()}
              >
                <Text style={modalStyles.buttonText}>ESTABLISH LINK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 15, 12, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
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
  button: {
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.m,
    paddingTop: theme.spacing.l,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    color: theme.colors.secondary,
    fontFamily: theme.typography.mono,
    letterSpacing: 1,
  },
  modeToggleRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  modeToggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  modeToggleBtnActive: {
    backgroundColor: theme.colors.secondary,
    borderColor: theme.colors.secondary,
  },
  modeToggleText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 10,
    fontWeight: 'bold',
  },
  modeToggleTextActive: {
    color: theme.colors.background,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    backgroundColor: theme.colors.secondary,
    marginRight: 6,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    fontFamily: theme.typography.mono,
  },
  list: {
    padding: theme.spacing.m,
    paddingBottom: 40,
  },
  messageWrapper: {
    marginBottom: 20,
  },
  userWrapper: {
    alignItems: 'flex-end',
  },
  gemmaWrapper: {
    alignItems: 'flex-start',
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  messageRole: {
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: theme.typography.mono,
  },
  messageTime: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
  },
  messageContent: {
    flexDirection: 'row',
    padding: 12,
    borderWidth: 1,
    borderRadius: 2,
    maxWidth: '90%',
    shadowColor: theme.colors.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  userContent: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderRightWidth: 4,
    borderRightColor: theme.colors.textSecondary,
    shadowOpacity: 0,
  },
  gemmaContent: {
    backgroundColor: '#100c00', // Very dark yellow/amber tint
    borderColor: theme.colors.secondary,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.secondary,
  },
  promptArrow: {
    color: theme.colors.secondary,
    fontFamily: theme.typography.mono,
    marginRight: 4,
  },
  text: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: theme.typography.mono,
    flexShrink: 1,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: theme.spacing.m,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    alignItems: 'center',
  },
  inputPrefix: {
    color: theme.colors.secondary,
    fontFamily: theme.typography.mono,
    fontSize: 16,
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: theme.colors.secondary,
    paddingVertical: 8,
    maxHeight: 120,
    minHeight: 40,
    fontSize: 14,
    fontFamily: theme.typography.mono,
  },
  button: {
    backgroundColor: theme.colors.secondary,
    borderRadius: 2,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  photoBtn: {
    backgroundColor: theme.colors.warning,
    borderRadius: 2,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  pendingPhotoStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.m,
    paddingVertical: 6,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  pendingPhotoThumb: {
    width: 36,
    height: 36,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: theme.colors.warning,
    marginRight: 10,
  },
  pendingPhotoText: {
    flex: 1,
    color: theme.colors.warning,
    fontFamily: theme.typography.mono,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  messageImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    maxHeight: 180,
    borderRadius: 2,
    marginBottom: 6,
    backgroundColor: theme.colors.background,
  },
  downloadContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  downloadText: {
    color: theme.colors.secondary,
    fontFamily: theme.typography.mono,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: 'bold',
  },
  downloadBtn: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: theme.colors.secondary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 4,
  },
  downloadBtnText: {
    color: theme.colors.secondary,
    fontFamily: theme.typography.mono,
    fontSize: 14,
    fontWeight: 'bold',
  },
  progressBarContainer: {
    width: '100%',
    height: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    position: 'relative',
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.secondary,
    opacity: 0.3,
  },
  progressText: {
    color: theme.colors.secondary,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: 'bold',
    zIndex: 1,
  },
});
