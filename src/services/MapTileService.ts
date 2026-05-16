import * as FileSystem from 'expo-file-system/legacy';
import {
  OfflineManager,
  type OfflinePack,
  type OfflinePackStatus,
} from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

export type TileBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type PreloadProgress = {
  state: 'inactive' | 'active' | 'complete';
  percentage: number;       // 0..100
  completedTileCount: number;
  requiredResourceCount: number;
};

const TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const STYLE_FILE_NAME = 'meshgemma-style.json';
const PACK_NAME = 'meshgemma-demo-pack';
const DEFAULT_MIN_ZOOM = 12;
const DEFAULT_MAX_ZOOM = 15;

class MapTileServiceImpl {
  private styleUrlPromise: Promise<string> | null = null;

  getStyle(): StyleSpecification {
    return {
      version: 8,
      name: 'meshgemma-offline',
      sources: {
        'osm-raster': {
          type: 'raster',
          tiles: [TILE_URL_TEMPLATE],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 19,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm-raster-layer',
          type: 'raster',
          source: 'osm-raster',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    };
  }

  // OfflineManager.createPack requires a style URL (not an inline object), so
  // we materialize the style as a file once and reuse it.
  async getStyleUrl(): Promise<string> {
    if (this.styleUrlPromise) return this.styleUrlPromise;
    this.styleUrlPromise = this.writeStyleFile().catch((err) => {
      this.styleUrlPromise = null;
      throw err;
    });
    return this.styleUrlPromise;
  }

  private async writeStyleFile(): Promise<string> {
    const docDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
    if (!docDir) {
      throw new Error('No writable file system directory available');
    }
    const path = `${docDir}${STYLE_FILE_NAME}`;
    const json = JSON.stringify(this.getStyle());
    await FileSystem.writeAsStringAsync(path, json);
    return path;
  }

  estimateTiles(
    bounds: TileBounds,
    minZoom: number = DEFAULT_MIN_ZOOM,
    maxZoom: number = DEFAULT_MAX_ZOOM,
  ): number {
    let total = 0;
    for (let z = minZoom; z <= maxZoom; z++) {
      const { xMin, xMax, yMin, yMax } = this.tileRangeForZoom(bounds, z);
      total += (xMax - xMin + 1) * (yMax - yMin + 1);
    }
    return total;
  }

  // Real preload via MapLibre native OfflineManager. The pack lives in the
  // native SDK's SQLite store; tiles fetched here are reused by live renders
  // because MapLibre's ambient cache is keyed by tile URL.
  async preloadArea(
    bounds: TileBounds,
    opts?: {
      minZoom?: number;
      maxZoom?: number;
      onProgress?: (p: PreloadProgress) => void;
      signal?: AbortSignal;
    },
  ): Promise<PreloadProgress> {
    const minZoom = opts?.minZoom ?? DEFAULT_MIN_ZOOM;
    const maxZoom = opts?.maxZoom ?? DEFAULT_MAX_ZOOM;
    const onProgress = opts?.onProgress;
    const signal = opts?.signal;

    const styleURL = await this.getStyleUrl();

    // Drop any existing meshgemma packs so the user can re-preload a new area.
    // Packs are matched by metadata.name since pack IDs are auto-generated UUIDs.
    try {
      const existing = await OfflineManager.getPacks();
      for (const p of existing) {
        const m = p.metadata as { name?: string } | undefined;
        if (m && m.name === PACK_NAME) {
          await OfflineManager.deletePack(p.id);
        }
      }
    } catch {
      // best-effort
    }

    return new Promise<PreloadProgress>((resolve, reject) => {
      let pack: OfflinePack | null = null;
      let aborted = false;

      const finish = (result: PreloadProgress) => {
        cleanupAbort();
        resolve(result);
      };

      const fail = (err: Error) => {
        cleanupAbort();
        reject(err);
      };

      const onAbort = async () => {
        aborted = true;
        try {
          if (pack) {
            await pack.pause();
            await OfflineManager.deletePack(pack.id);
          }
        } catch {
          // best-effort
        }
        finish({
          state: 'inactive',
          percentage: 0,
          completedTileCount: 0,
          requiredResourceCount: 0,
        });
      };

      const cleanupAbort = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort);
      }

      const progress = (_p: OfflinePack, status: OfflinePackStatus) => {
        if (aborted) return;
        const snapshot: PreloadProgress = {
          state: status.state,
          percentage: status.percentage,
          completedTileCount: status.completedTileCount,
          requiredResourceCount: status.requiredResourceCount,
        };
        if (onProgress) onProgress(snapshot);
        if (status.state === 'complete') {
          finish(snapshot);
        }
      };

      const error = (_p: OfflinePack, err: { message: string }) => {
        if (aborted) return;
        fail(new Error(err.message || 'Offline pack download failed'));
      };

      OfflineManager.createPack(
        {
          mapStyle: styleURL,
          bounds: [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat],
          minZoom,
          maxZoom,
          metadata: { name: PACK_NAME },
        },
        progress,
        error,
      )
        .then((created) => {
          pack = created;
          // OfflineManager.createPack starts the download automatically in v11;
          // resume() is a no-op if already active, but harmless if it isn't.
          return created.resume();
        })
        .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
    });
  }

  async deleteOfflinePack(): Promise<void> {
    try {
      const existing = await OfflineManager.getPacks();
      for (const p of existing) {
        const m = p.metadata as { name?: string } | undefined;
        if (m && m.name === PACK_NAME) {
          await OfflineManager.deletePack(p.id);
        }
      }
    } catch {
      // best-effort
    }
  }

  private tileRangeForZoom(
    bounds: TileBounds,
    z: number,
  ): { xMin: number; xMax: number; yMin: number; yMax: number } {
    const n = Math.pow(2, z);
    const xMinRaw = Math.floor(((bounds.minLng + 180) / 360) * n);
    const xMaxRaw = Math.floor(((bounds.maxLng + 180) / 360) * n);
    const yMinRaw = this.latToTileY(bounds.maxLat, z);
    const yMaxRaw = this.latToTileY(bounds.minLat, z);
    const clamp = (v: number): number => Math.max(0, Math.min(n - 1, v));
    return {
      xMin: clamp(Math.min(xMinRaw, xMaxRaw)),
      xMax: clamp(Math.max(xMinRaw, xMaxRaw)),
      yMin: clamp(Math.min(yMinRaw, yMaxRaw)),
      yMax: clamp(Math.max(yMinRaw, yMaxRaw)),
    };
  }

  private latToTileY(lat: number, z: number): number {
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = (clampedLat * Math.PI) / 180;
    const n = Math.pow(2, z);
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  }
}

export const mapTileService = new MapTileServiceImpl();
export type MapTileService = MapTileServiceImpl;
