import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Clipboard,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../theme/colors';
import {
  CompressResult,
  RadioCompressError,
  RadioChatMessage,
  compressFeed,
  estimateLoraAirtimeMs,
  rawFeedBytes,
} from '../services/RadioCompressService';
import type { Incident } from '../services/MockDatabase';

type Props = {
  visible: boolean;
  onClose: () => void;
  feed: Incident[];
  chats?: RadioChatMessage[];
  aiComputeMode: 'remote' | 'local';
  serverIp: string;
};

type TxStage = 'idle' | 'encoding' | 'tx' | 'ack';

const FEED_N_DEFAULT = 50;
const BYTE_BUDGET = 200;

export default function RadioPanel({
  visible,
  onClose,
  feed,
  chats = [],
  aiComputeMode,
  serverIp,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompressResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [errRaw, setErrRaw] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);
  const [txStage, setTxStage] = useState<TxStage>('idle');

  const txTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const rawBytesPreview = useMemo(
    () => rawFeedBytes(feed, FEED_N_DEFAULT, chats),
    [feed, chats],
  );
  const totalRecords = feed.length + chats.length;

  // Reset transient state every time the panel re-opens. We keep `result` if
  // the user is just re-opening — they may want to re-transmit the same
  // payload — but always clear errors and tx animation.
  useEffect(() => {
    if (visible) {
      setErrMsg(null);
      setErrRaw(null);
      setTxStage('idle');
      setCopyFlash(false);
    } else {
      // closing → cancel any in-flight tx animation
      txTimers.current.forEach((t) => clearTimeout(t));
      txTimers.current = [];
      setTxStage('idle');
    }
  }, [visible]);

  useEffect(() => {
    return () => {
      txTimers.current.forEach((t) => clearTimeout(t));
      txTimers.current = [];
    };
  }, []);

  const runCompress = async () => {
    if (busy) return;
    if (totalRecords === 0) {
      setErrMsg(
        'Nothing to compress yet. Post an incident on the FEED tab or send a message on the CHAT tab first.',
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    setErrMsg(null);
    setErrRaw(null);
    setResult(null);
    try {
      const res = await compressFeed({
        mode: aiComputeMode,
        serverIp,
        feed,
        chats,
        n: FEED_N_DEFAULT,
        byteBudget: BYTE_BUDGET,
      });
      setResult(res);
      if (res.truncated) {
        setErrMsg(
          `Output was ${res.compressedBytes} B after ${res.attempts} attempt(s) — over the ${BYTE_BUDGET} B budget. Showing it anyway.`,
        );
      }
    } catch (e: any) {
      console.warn('compressFeed failed:', e);
      if (e instanceof RadioCompressError) {
        setErrMsg(e.message);
        setErrRaw(e.rawOutput);
      } else {
        // Surface the real error message (HTTP status, non-JSON, abort, ...)
        // so the user can tell a misconfigured IP from a 500 from a parser
        // failure. Fall back to a friendly generic line if we have no detail.
        const detail = typeof e?.message === 'string' && e.message.length > 0
          ? e.message
          : null;
        const friendly = aiComputeMode === 'remote'
          ? `Could not reach base station at ${serverIp}:8080.`
          : 'Local Gemma compression failed. Check console.';
        setErrMsg(detail ? `${friendly} (${detail})` : friendly);
      }
    } finally {
      setBusy(false);
    }
  };

  const copyJson = () => {
    if (!result) return;
    try {
      Clipboard.setString(result.json);
      Haptics.selectionAsync();
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 1200);
    } catch (e) {
      console.warn('Clipboard.setString failed:', e);
    }
  };

  const startTransmit = () => {
    if (!result || txStage !== 'idle') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    // Auto-copy on transmit so the simulated "ACK" is meaningful: payload is
    // already in the user's clipboard for hand-off to a real radio path.
    try {
      Clipboard.setString(result.json);
    } catch {
      // best-effort
    }

    setTxStage('encoding');
    txTimers.current.push(
      setTimeout(() => setTxStage('tx'), 900),
      setTimeout(() => setTxStage('ack'), 2100),
      setTimeout(() => {
        setTxStage('idle');
      }, 3600),
    );
  };

  const stageLine = () => {
    switch (txStage) {
      case 'encoding':
        return 'ENCODING…';
      case 'tx':
        return 'TX @ 868 MHz · SF7 · BW125…';
      case 'ack':
        return 'ACK 0x4F · PAYLOAD COPIED TO CLIPBOARD';
      case 'idle':
      default:
        return 'STANDBY';
    }
  };

  const ratioStr = result ? result.ratio.toFixed(1) : '—';
  const airtimeMs = result ? estimateLoraAirtimeMs(result.compressedBytes) : 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="radio-outline" size={20} color={theme.colors.warning} />
            <Text style={styles.headerTitle}>RADIO UPLINK // GOV DISPATCH</Text>
            <TouchableOpacity
              onPress={onClose}
              style={{ marginLeft: 'auto', padding: 6 }}
            >
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.headerSubtitle}>
            COMPRESS LOCAL FEED → ≤{BYTE_BUDGET} BYTE JSON · MODE: {aiComputeMode.toUpperCase()}
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.byteCounterRow}>
            <View style={styles.byteCol}>
              <Text style={styles.byteLabel}>RAW FEED</Text>
              <Text style={styles.byteValue}>
                {rawBytesPreview.toLocaleString()} B
              </Text>
            </View>
            <Ionicons
              name="arrow-forward"
              size={18}
              color={theme.colors.textSecondary}
            />
            <View style={styles.byteCol}>
              <Text style={styles.byteLabel}>COMPRESSED</Text>
              <Text
                style={[
                  styles.byteValue,
                  result && result.compressedBytes <= BYTE_BUDGET
                    ? { color: theme.colors.success }
                    : result
                      ? { color: theme.colors.danger }
                      : { color: theme.colors.textSecondary },
                ]}
              >
                {result ? `${result.compressedBytes} B` : '— B'}
              </Text>
            </View>
            <View style={styles.byteCol}>
              <Text style={styles.byteLabel}>RATIO</Text>
              <Text style={[styles.byteValue, { color: theme.colors.warning }]}>
                {result ? `${ratioStr}×` : '—'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.compressBtn, busy && { opacity: 0.6 }]}
            onPress={runCompress}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.background} />
            ) : (
              <Text style={styles.compressBtnText}>
                {result ? 'RECOMPRESS' : 'COMPRESS FEED'}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.helperText}>
            Reading {feed.length} incident{feed.length === 1 ? '' : 's'} + {chats.length} chat
            {chats.length === 1 ? '' : 's'} from the local mesh state.
          </Text>

          {totalRecords === 0 && !result && (
            <Text style={styles.helperText}>
              Nothing to compress yet. Post on FEED or send on CHAT first.
            </Text>
          )}

          {errMsg && (
            <View style={styles.errBox}>
              <Text style={styles.errTitle}>ERR</Text>
              <Text style={styles.errMsg}>{errMsg}</Text>
              {errRaw && (
                <ScrollView style={styles.errRaw} horizontal>
                  <Text style={styles.errRawText}>{errRaw}</Text>
                </ScrollView>
              )}
              <TouchableOpacity style={styles.retryBtn} onPress={runCompress}>
                <Text style={styles.retryBtnText}>RETRY</Text>
              </TouchableOpacity>
            </View>
          )}

          {result && (
            <View style={styles.jsonBox}>
              <View style={styles.jsonHeaderRow}>
                <Text style={styles.jsonHeader}>RADIO PAYLOAD</Text>
                <TouchableOpacity style={styles.copyBtn} onPress={copyJson}>
                  <Ionicons
                    name={copyFlash ? 'checkmark' : 'copy-outline'}
                    size={14}
                    color={
                      copyFlash ? theme.colors.success : theme.colors.warning
                    }
                  />
                  <Text
                    style={[
                      styles.copyBtnText,
                      copyFlash && { color: theme.colors.success },
                    ]}
                  >
                    {copyFlash ? 'COPIED' : 'COPY'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.jsonText}>{result.json}</Text>
              <View style={styles.jsonMetaRow}>
                <Text style={styles.jsonMeta}>
                  ATTEMPTS: {result.attempts}
                </Text>
                <Text style={styles.jsonMeta}>
                  AIRTIME (LoRa SF7): ~{airtimeMs} ms
                </Text>
              </View>
            </View>
          )}

          {result && (
            <View style={styles.txBlock}>
              <TouchableOpacity
                style={[
                  styles.txBtn,
                  txStage !== 'idle' && { opacity: 0.7 },
                ]}
                onPress={startTransmit}
                disabled={txStage !== 'idle'}
              >
                <Ionicons name="send" size={16} color={theme.colors.background} />
                <Text style={styles.txBtnText}>
                  {txStage === 'idle' ? 'TRANSMIT' : 'TRANSMITTING…'}
                </Text>
              </TouchableOpacity>
              <View style={styles.txStageBox}>
                <Text style={styles.txStageText}>{stageLine()}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Persistent simulated banner — pinned outside the ScrollView so it
            stays visible regardless of result/error length, satisfying the
            spec's "always visible when the panel is open" rule. */}
        <View style={styles.simBanner}>
          <Ionicons
            name="warning"
            size={14}
            color={theme.colors.background}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.simBannerText}>
            SIMULATED — NO LORA RADIO IN THIS BUILD. PAYLOAD COPIED TO
            CLIPBOARD ON TRANSMIT.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingTop: 56,
    paddingHorizontal: theme.spacing.m,
    paddingBottom: theme.spacing.m,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: theme.colors.warning,
    fontFamily: theme.typography.mono,
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
  headerSubtitle: {
    marginTop: 4,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 10,
  },
  body: {
    padding: theme.spacing.m,
    paddingBottom: theme.spacing.xl,
  },
  byteCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.m,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.m,
  },
  byteCol: {
    alignItems: 'center',
    flex: 1,
  },
  byteLabel: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    fontFamily: theme.typography.mono,
    letterSpacing: 1,
  },
  byteValue: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    fontFamily: theme.typography.mono,
    marginTop: 2,
  },
  compressBtn: {
    backgroundColor: theme.colors.warning,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 4,
    marginBottom: theme.spacing.m,
  },
  compressBtnText: {
    color: theme.colors.background,
    fontFamily: theme.typography.mono,
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 2,
  },
  helperText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: theme.spacing.m,
  },
  errBox: {
    borderWidth: 1,
    borderColor: theme.colors.danger,
    backgroundColor: '#1a0a0a',
    padding: theme.spacing.m,
    marginBottom: theme.spacing.m,
  },
  errTitle: {
    color: theme.colors.danger,
    fontFamily: theme.typography.mono,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1,
  },
  errMsg: {
    color: theme.colors.text,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  errRaw: {
    backgroundColor: theme.colors.background,
    padding: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 8,
    maxHeight: 80,
  },
  errRawText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 11,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.danger,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  retryBtnText: {
    color: theme.colors.danger,
    fontFamily: theme.typography.mono,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1,
  },
  jsonBox: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.warning,
    padding: theme.spacing.m,
    marginBottom: theme.spacing.m,
  },
  jsonHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  jsonHeader: {
    color: theme.colors.warning,
    fontFamily: theme.typography.mono,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: theme.colors.warning,
  },
  copyBtnText: {
    color: theme.colors.warning,
    fontFamily: theme.typography.mono,
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  jsonText: {
    color: theme.colors.text,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  jsonMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  jsonMeta: {
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 10,
  },
  txBlock: {
    marginBottom: theme.spacing.m,
  },
  txBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.colors.warning,
    paddingVertical: 12,
    borderRadius: 4,
    marginBottom: 8,
  },
  txBtnText: {
    color: theme.colors.background,
    fontFamily: theme.typography.mono,
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 2,
  },
  txStageBox: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 10,
    backgroundColor: theme.colors.background,
  },
  txStageText: {
    color: theme.colors.warning,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    letterSpacing: 1,
  },
  simBanner: {
    backgroundColor: theme.colors.warning,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 2,
  },
  simBannerText: {
    color: theme.colors.background,
    fontFamily: theme.typography.mono,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
    flex: 1,
  },
});
