import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../theme/colors';
import { useAppContext } from '../context/AppContext';

// Local mirror of the ChatMessage shape. The integrator will export this from
// AppContext after wiring; the structural shape will silently match.
type ChatMessage = {
  id: string;
  pubKey: string;
  shortId: string;
  displayName?: string;
  text: string;
  ts: number;
  isMine: boolean;
};

// AppContext doesn't yet expose `chats` / `sendChat`. We cast through unknown
// so this file compiles cleanly today; the integrator will replace the cast
// with the real context shape once they ship the CHAT plumbing.
type ChatContextShape = {
  identity: { shortId: string; pubKey: string } | null;
  ready: 'booting' | 'ready' | 'error';
  peers: { id: string }[];
  chats: ChatMessage[];
  sendChat: (text: string) => Promise<void>;
  clearChats: () => Promise<void>;
};

function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function ChatScreen() {
  const ctx = useAppContext() as unknown as ChatContextShape;
  const { identity, ready, peers, chats, sendChat, clearChats } = ctx;

  const confirmClearChats = () => {
    Alert.alert(
      'Clear chat history?',
      'Removes all messages on this device. Other peers keep their copies.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => { clearChats().catch(() => {}); } },
      ],
    );
  };

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  const canSend =
    !!input.trim() && !!identity && ready === 'ready' && !sending;

  // Auto-scroll on mount and whenever a new message arrives.
  useEffect(() => {
    if (chats.length === 0) return;
    // Defer to next frame so layout has settled.
    const t = setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(t);
  }, [chats.length]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || !identity || ready !== 'ready' || sending) return;

    setSending(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await sendChat(trimmed);
      setInput('');
      // Scroll after the new chat is appended; the effect above will also fire,
      // but this is an immediate nudge for snappier UX.
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error sending message.';
      Alert.alert('Send failed', message);
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }: ListRenderItemInfo<ChatMessage>) => {
    const time = formatClock(item.ts);
    const senderLabel = item.displayName && item.displayName.length > 0
      ? item.displayName
      : `NODE-${item.shortId}`;
    const meta = item.isMine ? time : `${senderLabel} · ${time}`;

    return (
      <View
        style={[
          styles.row,
          item.isMine ? styles.rowMine : styles.rowOther,
        ]}
      >
        <Text
          style={[
            styles.meta,
            item.isMine ? styles.metaMine : styles.metaOther,
          ]}
        >
          {meta}
        </Text>
        <View
          style={[
            styles.bubble,
            item.isMine ? styles.bubbleMine : styles.bubbleOther,
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              item.isMine ? styles.bubbleTextMine : styles.bubbleTextOther,
            ]}
          >
            {item.text}
          </Text>
        </View>
      </View>
    );
  };

  const statusReady = ready === 'ready' && !!identity;
  const statusText = statusReady
    ? `NODE-${identity!.shortId} // PEERS: ${peers.length}`
    : 'IDENTITY BOOTING...';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>COMMS // P2P CHAT</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: statusReady
                    ? theme.colors.success
                    : theme.colors.textSecondary,
                },
              ]}
            />
            <Text
              style={[
                styles.statusText,
                {
                  color: statusReady
                    ? theme.colors.success
                    : theme.colors.textSecondary,
                },
              ]}
            >
              {statusText}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={confirmClearChats}
          style={{ padding: 8 }}
          disabled={chats.length === 0}
        >
          <Ionicons
            name="trash-outline"
            size={22}
            color={chats.length === 0 ? theme.colors.textSecondary : theme.colors.danger}
          />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <FlatList
          ref={flatListRef}
          style={styles.flex}
          data={chats}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={
            chats.length === 0 ? styles.emptyContent : styles.listContent
          }
          onContentSizeChange={() => {
            if (chats.length > 0) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>NO MESSAGES YET. SAY HI.</Text>
          }
        />

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="TRANSMIT MESSAGE..."
            placeholderTextColor={theme.colors.textSecondary}
            multiline
            maxLength={500}
            editable={ready === 'ready' && !!identity}
            autoCapitalize="sentences"
          />
          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.7}
          >
            <Ionicons
              name="paper-plane"
              size={18}
              color={theme.colors.background}
            />
          </TouchableOpacity>
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
  flex: {
    flex: 1,
  },
  header: {
    padding: theme.spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    color: theme.colors.text,
    fontFamily: theme.typography.mono,
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    marginRight: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: theme.typography.mono,
    letterSpacing: 0.5,
  },
  listContent: {
    padding: theme.spacing.m,
    paddingBottom: theme.spacing.s,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.l,
  },
  emptyText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    letterSpacing: 1,
    textAlign: 'center',
  },
  row: {
    marginBottom: theme.spacing.m,
    maxWidth: '85%',
  },
  rowMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  rowOther: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  meta: {
    fontSize: 10,
    fontFamily: theme.typography.mono,
    color: theme.colors.textSecondary,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  metaMine: {
    textAlign: 'right',
    paddingRight: 4,
  },
  metaOther: {
    textAlign: 'left',
    paddingLeft: 4,
  },
  bubble: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  bubbleMine: {
    backgroundColor: theme.colors.primary,
    // Sharp corner facing the screen edge for the tactical feel.
    borderTopRightRadius: 0,
  },
  bubbleOther: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderTopLeftRadius: 0,
  },
  bubbleText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: theme.typography.mono,
  },
  bubbleTextMine: {
    color: theme.colors.background,
    fontWeight: 'bold',
  },
  bubbleTextOther: {
    color: theme.colors.text,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: theme.spacing.m,
    paddingTop: theme.spacing.s,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: theme.colors.background,
    color: theme.colors.success,
    fontFamily: theme.typography.mono,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 4,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: theme.colors.success,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});
