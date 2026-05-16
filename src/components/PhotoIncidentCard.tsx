import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { analyzePhoto, VisionUnavailableError } from '../services/VisionAnalyzeService';
import type { Incident } from '../services/MockDatabase';

type Props = {
  incident: Incident;
  aiComputeMode: 'remote' | 'local';
  serverIp: string;
  onAnalysisComplete: (text: string) => void;
};

// Renders a thumbnail + ANALYZE button + AI description block. Used inline by
// FeedScreen *only* for incidents that carry an `imageB64` payload.
export default function PhotoIncidentCard({
  incident,
  aiComputeMode,
  serverIp,
  onAnalysisComplete,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);

  if (!incident.imageB64) return null;

  const dataUri = `data:image/jpeg;base64,${incident.imageB64}`;
  const analysis = incident.visionAnalysis;
  const remoteAvailable = aiComputeMode === 'remote' && !!serverIp;

  const runAnalyze = async () => {
    if (busy) return;
    if (!remoteAvailable) {
      setErr('Vision requires base station in this build.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await analyzePhoto({
        serverIp,
        imageB64: incident.imageB64!,
      });
      onAnalysisComplete(res.text);
    } catch (e: any) {
      console.warn('analyzePhoto failed:', e);
      if (e instanceof VisionUnavailableError) {
        setErr(e.message);
      } else {
        setErr(`Vision analysis failed: ${e?.message ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity onPress={() => setZoom(true)} activeOpacity={0.85}>
        <Image source={{ uri: dataUri }} style={styles.thumb} resizeMode="cover" />
      </TouchableOpacity>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[
            styles.analyzeBtn,
            (!remoteAvailable || busy) && { opacity: 0.5 },
          ]}
          onPress={runAnalyze}
          disabled={!remoteAvailable || busy}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.background} size="small" />
          ) : (
            <>
              <Ionicons name="eye-outline" size={14} color={theme.colors.background} />
              <Text style={styles.analyzeBtnText}>
                {analysis ? 'RE-ANALYZE' : 'ANALYZE'}
              </Text>
            </>
          )}
        </TouchableOpacity>
        {!remoteAvailable && (
          <Text style={styles.disabledHint}>
            Vision requires base station in this build.
          </Text>
        )}
      </View>

      {err && <Text style={styles.errText}>{err}</Text>}

      {analysis && (
        <View style={styles.analysisBox}>
          <Text style={styles.analysisHeader}>GEMMA VISION REPORT</Text>
          <Text style={styles.analysisText}>{analysis}</Text>
        </View>
      )}

      <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
        <TouchableOpacity
          style={zoomStyles.overlay}
          activeOpacity={1}
          onPress={() => setZoom(false)}
        >
          <Image source={{ uri: dataUri }} style={zoomStyles.full} resizeMode="contain" />
          <TouchableOpacity style={zoomStyles.closeBtn} onPress={() => setZoom(false)}>
            <Ionicons name="close" size={28} color={theme.colors.text} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    marginBottom: 4,
  },
  thumb: {
    width: '100%',
    height: 160,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.secondary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 2,
  },
  analyzeBtnText: {
    color: theme.colors.background,
    fontFamily: theme.typography.mono,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1.5,
  },
  disabledHint: {
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
    fontSize: 10,
    flex: 1,
  },
  errText: {
    color: theme.colors.danger,
    fontFamily: theme.typography.mono,
    fontSize: 11,
    marginTop: 6,
  },
  analysisBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.colors.secondary,
    borderLeftWidth: 4,
    backgroundColor: '#100c00',
    padding: 10,
  },
  analysisHeader: {
    color: theme.colors.secondary,
    fontFamily: theme.typography.mono,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  analysisText: {
    color: theme.colors.text,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    lineHeight: 17,
  },
});

const zoomStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  full: {
    width: '100%',
    height: '80%',
  },
  closeBtn: {
    position: 'absolute',
    top: 50,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 22,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
