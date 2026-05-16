import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

// Target envelope budget on the wire ~30 KB so the signed envelope still fits
// inside MultipeerConnectivity's ~60 KB practical message cap with overhead.
// Worst-case base64 expands by 4/3 → ~22 KB raw JPEG → 30 KB base64. We aim
// 320x240 JPEG q=70 first; if that's still too big we degrade to q=50 then
// 240x180 q=50.
const PRIMARY = { width: 320, height: 240, quality: 0.7 };
const FALLBACK_1 = { width: 320, height: 240, quality: 0.5 };
const FALLBACK_2 = { width: 240, height: 180, quality: 0.5 };
const TARGET_RAW_BYTES = 22_000; // ~30 KB after base64

export type ResizedImage = {
  base64: string;
  // Local file URI of the resized JPEG. Used when we need to hand a file
  // path to a native module (e.g. llama.rn `media_paths` for on-device
  // vision); the wire path uses base64 instead.
  uri: string;
  width: number;
  height: number;
  rawBytes: number;
  base64Bytes: number;
};

// `getInfoAsync` returns `size` automatically when the file exists in newer
// expo-file-system; we don't pass any extra options. Returns 0 if the size
// can't be determined (caller will fall back to a base64-derived estimate).
async function readBytes(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof (info as any).size === 'number') {
      return (info as any).size as number;
    }
  } catch (e) {
    console.warn('[imageResize] getInfoAsync failed:', e);
  }
  return 0;
}

// Estimate raw JPEG bytes from a base64 string. Base64 expands by 4/3, plus
// padding ('=' chars). Used as a fallback when the filesystem can't report
// the on-disk size — better to show a plausible KB number than 0.
function estimateBytesFromB64(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

async function manipulate(
  uri: string,
  width: number,
  height: number,
  quality: number,
): Promise<ImageManipulator.ImageResult> {
  return ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width, height } }],
    {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    },
  );
}

export async function resizeForMesh(uri: string): Promise<ResizedImage> {
  const attempts = [PRIMARY, FALLBACK_1, FALLBACK_2];
  let last: ImageManipulator.ImageResult | null = null;
  let lastBytes = 0;
  for (const a of attempts) {
    const out = await manipulate(uri, a.width, a.height, a.quality);
    last = out;
    const fsBytes = await readBytes(out.uri);
    // Use the filesystem size when we can read it; otherwise estimate from
    // base64 so the UI doesn't show "0.0 KB" and so the budget check below
    // still has a meaningful number to compare against.
    lastBytes = fsBytes > 0 ? fsBytes : estimateBytesFromB64(out.base64 ?? '');
    if (lastBytes > 0 && lastBytes <= TARGET_RAW_BYTES) {
      break;
    }
  }
  if (!last || !last.base64) {
    throw new Error('Image resize returned no base64 output');
  }
  // Final defensive estimate — guarantees rawBytes is non-zero on success so
  // downstream UI / cap-checks aren't fooled.
  if (lastBytes === 0) {
    lastBytes = estimateBytesFromB64(last.base64);
  }
  return {
    base64: last.base64,
    uri: last.uri,
    width: last.width,
    height: last.height,
    rawBytes: lastBytes,
    base64Bytes: last.base64.length,
  };
}
