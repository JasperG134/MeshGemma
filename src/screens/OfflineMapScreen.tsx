import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Network from 'expo-network';
import {
  Camera,
  Map,
  Marker,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';

import { useAppContext, type PeerLocation } from '../context/AppContext';
import { locationService, type Coords } from '../services/LocationService';
import { mapTileService, type TileBounds, type PreloadProgress } from '../services/MapTileService';
import type { Incident } from '../services/MockDatabase';

const FALLBACK_CENTER = { lat: 34.05, lng: -118.24 };
const INITIAL_ZOOM = 13;
const PRELOAD_FALLBACK_HALF_DEG = 0.025;

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s AGO`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m AGO`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h AGO`;
  return `${Math.round(ms / 86_400_000)}d AGO`;
}

const ACCENT = '#3FFF8E';
const BG = '#000';
const FG = '#FFF';
const PILL_ONLINE_BG = 'rgba(63, 255, 142, 0.15)';
const PILL_OFFLINE_BG = 'rgba(255, 59, 48, 0.18)';
const PILL_ONLINE_FG = '#3FFF8E';
const PILL_OFFLINE_FG = '#FF3B30';

const MARKER_COLORS: Record<Incident['type'], string> = {
  medical: '#FF8C00',
  hazard: '#FF3B30',
  supply: '#34C759',
  general: '#FFD60A',
};

// A peer is "live" if we received their location within this window. After
// that they show as a stale last-known marker. Tuned to 60 s — twice the
// heartbeat interval so a single missed beat doesn't blink them stale.
const PEER_LIVE_WINDOW_MS = 60_000;
// Hide a peer entirely if we haven't seen them this long. Long enough that
// "last known location" is still useful in a SAR scenario.
const PEER_VISIBLE_WINDOW_MS = 24 * 60 * 60 * 1000;

type ConnectivityStatus = 'unknown' | 'online' | 'offline';

export default function OfflineMapScreen(): React.ReactElement {
  const { feed, peerLocations } = useAppContext();
  const insets = useSafeAreaInsets();
  const [selectedPeer, setSelectedPeer] = useState<PeerLocation | null>(null);
  // Re-render every 10 s so the "last seen Xm ago" labels and the live/stale
  // marker color flip within a small window after the 60 s live threshold.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Demo override: pin pill to OFFLINE regardless of real connectivity.
  const [status, setStatus] = useState<ConnectivityStatus>('offline');
  const [userCoords, setUserCoords] = useState<Coords | null>(null);
  const [progress, setProgress] = useState<PreloadProgress | null>(null);
  const [estimate, setEstimate] = useState<number>(0);

  const initialCenter = useMemo<[number, number]>(() => {
    if (userCoords) return [userCoords.lng, userCoords.lat];
    const lastKnown = locationService.getLastKnown();
    if (lastKnown) return [lastKnown.lng, lastKnown.lat];
    const first = feed.find((i) => i.location !== null);
    if (first?.location) return [first.location.lng, first.location.lat];
    return [FALLBACK_CENTER.lng, FALLBACK_CENTER.lat];
  }, [feed, userCoords]);

  const mapStyle = useMemo(() => mapTileService.getStyle(), []);

  // Demo override: ignore real connectivity, always show OFFLINE.
  // (Original network probe is intentionally disabled below.)
  useEffect(() => {
    setStatus('offline');
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    locationService
      .watchCoords((c) => {
        if (!cancelled) setUserCoords(c);
      })
      .then((stop) => {
        if (cancelled) {
          stop();
          return;
        }
        unsubscribe = stop;
      })
      .catch(() => {
        // Permission denied or unavailable — silently skip live tracking.
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const handleMyLocation = useCallback(async () => {
    try {
      const coords = await locationService.getCurrentCoords();
      if (!coords) {
        Alert.alert('Location unavailable');
        return;
      }
      cameraRef.current?.flyTo({
        center: [coords.lng, coords.lat],
        zoom: INITIAL_ZOOM + 1,
        duration: 800,
      });
    } catch {
      Alert.alert('Location unavailable');
    }
  }, []);

  const resolveBounds = useCallback(async (): Promise<TileBounds> => {
    try {
      const ll = await mapRef.current?.getBounds();
      if (ll && ll.length === 4) {
        const [west, south, east, north] = ll;
        return { minLat: south, maxLat: north, minLng: west, maxLng: east };
      }
    } catch {
      // Fall through to fixed-box fallback.
    }
    const center = userCoords ?? { lat: initialCenter[1], lng: initialCenter[0] };
    return {
      minLat: center.lat - PRELOAD_FALLBACK_HALF_DEG,
      maxLat: center.lat + PRELOAD_FALLBACK_HALF_DEG,
      minLng: center.lng - PRELOAD_FALLBACK_HALF_DEG,
      maxLng: center.lng + PRELOAD_FALLBACK_HALF_DEG,
    };
  }, [initialCenter, userCoords]);

  const handlePreload = useCallback(async () => {
    if (progress !== null) return;
    const bounds = await resolveBounds();
    const tileEstimate = mapTileService.estimateTiles(bounds);
    Alert.alert(
      'Preload area?',
      `Approx ${tileEstimate} tiles will be downloaded into MapLibre's offline pack.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'OK',
          onPress: () => {
            const controller = new AbortController();
            abortRef.current = controller;
            setEstimate(tileEstimate);
            setProgress({
              state: 'active',
              percentage: 0,
              completedTileCount: 0,
              requiredResourceCount: tileEstimate,
            });
            mapTileService
              .preloadArea(bounds, {
                signal: controller.signal,
                onProgress: (p) => setProgress(p),
              })
              .catch((err) => {
                Alert.alert('Preload failed', err instanceof Error ? err.message : String(err));
              })
              .finally(() => {
                abortRef.current = null;
                setProgress(null);
              });
          },
        },
      ],
    );
  }, [progress, resolveBounds]);

  const handleCancelPreload = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const statusLabel = status === 'unknown' ? 'CHECKING' : status === 'online' ? 'ONLINE' : 'OFFLINE';
  const statusBg = status === 'online' ? PILL_ONLINE_BG : PILL_OFFLINE_BG;
  const statusFg = status === 'online' ? PILL_ONLINE_FG : PILL_OFFLINE_FG;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>OFFLINE MAP</Text>
        <View style={[styles.pill, { backgroundColor: statusBg }]}>
          <Text style={[styles.pillText, { color: statusFg }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.mapWrap}>
        <Map ref={mapRef} style={StyleSheet.absoluteFill} mapStyle={mapStyle}>
          <Camera
            ref={cameraRef}
            initialViewState={{
              center: initialCenter,
              zoom: INITIAL_ZOOM,
            }}
          />

          {feed.map((incident) => {
            if (!incident.location) return null;
            const color = MARKER_COLORS[incident.type];
            return (
              <Marker
                key={incident.id}
                id={incident.id}
                lngLat={[incident.location.lng, incident.location.lat]}
              >
                <View style={[styles.markerDot, { backgroundColor: color }]} />
              </Marker>
            );
          })}

          {peerLocations
            .filter((p) => now - p.lastSeen < PEER_VISIBLE_WINDOW_MS)
            .map((peer) => {
              const isLive = now - peer.lastSeen < PEER_LIVE_WINDOW_MS;
              const initial = (peer.displayName?.trim() || peer.shortId || '?')
                .charAt(0)
                .toUpperCase();
              // MapLibre v11's `Marker.onPress` is the reliable tap path on
              // iOS — wrapping the child in a TouchableOpacity does NOT
              // receive taps because the marker view sits in a non-
              // interactive overlay layer.
              return (
                <Marker
                  key={`peer-${peer.pubKey}`}
                  id={`peer-${peer.pubKey}`}
                  lngLat={[peer.lng, peer.lat]}
                  onPress={() => setSelectedPeer(peer)}
                >
                  <View
                    style={[
                      styles.peerDot,
                      isLive ? styles.peerDotLive : styles.peerDotStale,
                    ]}
                  >
                    <Text style={styles.peerDotInitial}>{initial}</Text>
                  </View>
                </Marker>
              );
            })}

          {userCoords ? (
            <Marker id="user-location" lngLat={[userCoords.lng, userCoords.lat]}>
              <View style={styles.userDot} />
            </Marker>
          ) : null}
        </Map>

        {selectedPeer ? (
          <View
            style={[
              styles.callout,
              { top: insets.top + 56 },
            ]}
          >
            <View style={styles.calloutHeaderRow}>
              <View
                style={[
                  styles.peerDotSmall,
                  now - selectedPeer.lastSeen < PEER_LIVE_WINDOW_MS
                    ? styles.peerDotLive
                    : styles.peerDotStale,
                ]}
              />
              <Text style={styles.calloutName} numberOfLines={1}>
                {selectedPeer.displayName?.trim() ||
                  `NODE-${selectedPeer.shortId.toUpperCase()}`}
              </Text>
              <TouchableOpacity
                onPress={() => setSelectedPeer(null)}
                style={styles.calloutClose}
              >
                <Text style={styles.calloutCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.calloutMeta}>
              {now - selectedPeer.lastSeen < PEER_LIVE_WINDOW_MS
                ? 'LIVE'
                : `LAST KNOWN · ${formatAgo(now - selectedPeer.lastSeen)}`}
            </Text>
            <Text style={styles.calloutMeta}>
              {selectedPeer.lat.toFixed(5)}, {selectedPeer.lng.toFixed(5)}
              {typeof selectedPeer.accuracy === 'number'
                ? `  ±${Math.round(selectedPeer.accuracy)} m`
                : ''}
            </Text>
            <TouchableOpacity
              style={styles.calloutBtn}
              onPress={() => {
                cameraRef.current?.flyTo({
                  center: [selectedPeer.lng, selectedPeer.lat],
                  zoom: INITIAL_ZOOM + 1,
                  duration: 700,
                });
              }}
            >
              <Text style={styles.calloutBtnText}>FLY TO</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.fab, styles.fabLeft]}
          onPress={handleMyLocation}
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>MY LOCATION</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.fab, styles.fabRight]}
          onPress={handlePreload}
          activeOpacity={0.8}
          disabled={progress !== null}
        >
          <Text style={styles.fabText}>PRELOAD AREA</Text>
        </TouchableOpacity>

        {progress !== null ? (
          <View style={styles.progressOverlay}>
            <ActivityIndicator size="small" color={ACCENT} />
            <Text style={styles.progressText}>
              {`Caching ${progress.completedTileCount} / ${
                progress.requiredResourceCount || estimate
              } (${Math.round(progress.percentage)}%)`}
            </Text>
            <TouchableOpacity onPress={handleCancelPreload} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    backgroundColor: BG,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  title: {
    color: FG,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  mapWrap: {
    flex: 1,
    position: 'relative',
  },
  markerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fff',
  },
  userDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#3B82F6',
    borderWidth: 2,
    borderColor: '#fff',
  },
  peerDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  peerDotLive: {
    backgroundColor: ACCENT,
    borderColor: '#fff',
  },
  peerDotStale: {
    backgroundColor: '#666',
    borderColor: '#aaa',
    opacity: 0.85,
  },
  peerDotInitial: {
    color: '#000',
    fontWeight: '900',
    fontSize: 12,
  },
  peerDotSmall: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    marginRight: 8,
  },
  callout: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.92)',
    borderWidth: 1,
    borderColor: ACCENT,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 6,
  },
  calloutHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  calloutName: {
    color: FG,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
    flex: 1,
  },
  calloutClose: {
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  calloutCloseText: {
    color: FG,
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '900',
  },
  calloutMeta: {
    color: '#bbb',
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  calloutBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  calloutBtnText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    backgroundColor: ACCENT,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  fabLeft: {
    left: 16,
  },
  fabRight: {
    right: 16,
  },
  fabText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  progressOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 1,
    borderColor: ACCENT,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressText: {
    color: FG,
    fontSize: 13,
    marginLeft: 10,
    flex: 1,
  },
  cancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: PILL_OFFLINE_FG,
    borderRadius: 4,
  },
  cancelBtnText: {
    color: PILL_OFFLINE_FG,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
