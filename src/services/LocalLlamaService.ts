import { initLlama, LlamaContext } from 'llama.rn';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

// Vision-capable Gemma 4 E2B at IQ2_M quantization (Unsloth dynamic quant).
// Pairs with the mmproj-F16 vision projector below — both files are required
// for `initMultimodal` to succeed. Total on-disk footprint ~3.28 GB.
const MODEL_URL = 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-UD-IQ2_M.gguf';
const MODEL_FILENAME = 'gemma-4-E2B-it-UD-IQ2_M.gguf';
const MODEL_BYTES = 2_290_858_112; // ~2.29 GB

const MMPROJ_URL = 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-F16.gguf';
const MMPROJ_FILENAME = 'gemma-4-E2B-it-mmproj-F16.gguf';
const MMPROJ_BYTES = 985_654_080; // ~986 MB

const TOTAL_BYTES = MODEL_BYTES + MMPROJ_BYTES;

export type DownloadStage = 'model' | 'mmproj';

export type DownloadProgress = {
  stage: DownloadStage;
  // 0..1 within the current file
  stageProgress: number;
  // 0..1 across both files combined — what the UI should show
  totalProgress: number;
  bytesWritten: number;
  bytesTotal: number;
};

export class LocalLlamaService {
  modelPath: string;
  mmprojPath: string;
  llamaContext: LlamaContext | null = null;
  // Set after a successful initMultimodal — used to gate vision-using calls
  // and surface a useful error if the projector failed to load.
  visionEnabled = false;
  downloadResumable: FileSystem.DownloadResumable | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.modelPath = `${FileSystem.documentDirectory}${MODEL_FILENAME}`;
    this.mmprojPath = `${FileSystem.documentDirectory}${MMPROJ_FILENAME}`;
  }

  private async fileExists(path: string): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(path);
    return info.exists;
  }

  /** Per-file presence + the convenience `all` flag. */
  async checkAssetsExist(): Promise<{ model: boolean; mmproj: boolean; all: boolean }> {
    const [model, mmproj] = await Promise.all([
      this.fileExists(this.modelPath),
      this.fileExists(this.mmprojPath),
    ]);
    return { model, mmproj, all: model && mmproj };
  }

  /** Backward-compat: existing callers expect a single bool. True iff both files exist. */
  async checkModelExists(): Promise<boolean> {
    const s = await this.checkAssetsExist();
    return s.all;
  }

  async checkDiskSpace(): Promise<{ ok: boolean; freeBytes: number }> {
    try {
      const freeBytes = await FileSystem.getFreeDiskStorageAsync();
      return { ok: freeBytes >= TOTAL_BYTES * 1.1, freeBytes };
    } catch {
      return { ok: true, freeBytes: 0 };
    }
  }

  private async downloadOne(
    url: string,
    targetPath: string,
    expectedBytes: number,
    onChunk: (bytesWritten: number, totalBytes: number) => void,
  ): Promise<void> {
    const info = await FileSystem.getInfoAsync(targetPath);
    if (info.exists && info.size === expectedBytes) {
      onChunk(expectedBytes, expectedBytes);
      return;
    }
    if (info.exists) {
      // A previous download was cancelled or interrupted, leaving a truncated
      // file. Treating it as complete would feed a corrupt GGUF to initLlama —
      // delete it and re-fetch from scratch.
      await FileSystem.deleteAsync(targetPath, { idempotent: true });
    }
    this.downloadResumable = FileSystem.createDownloadResumable(
      url,
      targetPath,
      {},
      (downloadProgress) => {
        const total = downloadProgress.totalBytesExpectedToWrite || expectedBytes;
        onChunk(downloadProgress.totalBytesWritten, total);
      }
    );
    try {
      const result = await this.downloadResumable.downloadAsync();
      if (!result) throw new Error('Download returned no result');
      if (result.status && result.status >= 400) {
        await FileSystem.deleteAsync(targetPath, { idempotent: true });
        throw new Error(`Download failed with HTTP ${result.status}`);
      }
    } catch (e) {
      try { await FileSystem.deleteAsync(targetPath, { idempotent: true }); } catch {}
      throw e;
    } finally {
      this.downloadResumable = null;
    }
  }

  async downloadModel(onProgress: (p: DownloadProgress) => void): Promise<void> {
    const status = await this.checkAssetsExist();
    if (status.all) return;

    const space = await this.checkDiskSpace();
    if (!space.ok) {
      throw new Error(
        `Insufficient disk space. Need ~${(TOTAL_BYTES / 1e9).toFixed(2)} GB, have ${(space.freeBytes / 1e9).toFixed(2)} GB.`,
      );
    }

    if (!status.model) {
      await this.downloadOne(MODEL_URL, this.modelPath, MODEL_BYTES, (bytesWritten, totalBytes) => {
        onProgress({
          stage: 'model',
          stageProgress: bytesWritten / Math.max(totalBytes, 1),
          totalProgress: bytesWritten / TOTAL_BYTES,
          bytesWritten,
          bytesTotal: totalBytes,
        });
      });
    }

    if (!status.mmproj) {
      await this.downloadOne(MMPROJ_URL, this.mmprojPath, MMPROJ_BYTES, (bytesWritten, totalBytes) => {
        onProgress({
          stage: 'mmproj',
          stageProgress: bytesWritten / Math.max(totalBytes, 1),
          totalProgress: (MODEL_BYTES + bytesWritten) / TOTAL_BYTES,
          bytesWritten,
          bytesTotal: totalBytes,
        });
      });
    }
  }

  async cancelDownload() {
    if (this.downloadResumable) {
      try { await this.downloadResumable.pauseAsync(); } catch {}
      this.downloadResumable = null;
    }
  }

  async initModel(): Promise<void> {
    if (this.llamaContext) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const status = await this.checkAssetsExist();
      if (!status.model) throw new Error('Model file not found on device.');

      try {
        // iOS: offload all layers to Metal. Android: CPU (OpenCL/Vulkan not
        // guaranteed on RC build — safer default).
        const n_gpu_layers = Platform.OS === 'ios' ? 99 : 0;
        // Bumped n_ctx from 2048 → 4096 to leave room for image tokens
        // (vision encoders typically inject 256–1024 tokens per image).
        this.llamaContext = await initLlama({
          model: this.modelPath,
          use_mlock: true,
          n_ctx: 4096,
          n_gpu_layers,
        });

        if (status.mmproj) {
          try {
            const ok = await this.llamaContext.initMultimodal({
              path: this.mmprojPath,
              use_gpu: Platform.OS === 'ios',
            });
            this.visionEnabled = !!ok;
          } catch (e) {
            console.warn('[LocalLlamaService] initMultimodal failed; vision disabled:', e);
            this.visionEnabled = false;
          }
        } else {
          this.visionEnabled = false;
        }
      } catch (e) {
        console.error('Failed to initialize llama context:', e);
        throw e;
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async completion(
    prompt: string,
    onToken?: (token: string) => void,
    options?: { mediaPath?: string },
  ): Promise<string> {
    if (!this.llamaContext) {
      await this.initModel();
    }

    if (!this.llamaContext) {
      throw new Error('Llama context is not initialized');
    }

    const params: any = {
      prompt,
      n_predict: 512,
      temperature: 0.7,
      top_p: 0.9,
      stop: ['<end_of_turn>', '<start_of_turn>', 'User:'],
    };
    if (options?.mediaPath) {
      if (!this.visionEnabled) {
        throw new Error('Vision is not enabled. Re-download the model and projector.');
      }
      // llama.rn passes media_paths straight to fopen() in rn-mtmd.hpp, which
      // doesn't understand the file:// URI scheme. ImageManipulator returns
      // file:// URIs on iOS, so strip the prefix and decode percent-escapes.
      const raw = options.mediaPath;
      const stripped = raw.startsWith('file://') ? raw.slice(7) : raw;
      let nativePath = stripped;
      try { nativePath = decodeURIComponent(stripped); } catch {}
      params.media_paths = [nativePath];
    }

    let fullResponse = '';

    try {
      const response = await this.llamaContext.completion(params, (data) => {
        if (data.token) {
          fullResponse += data.token;
          if (onToken) onToken(data.token);
        }
      });
      return response.text;
    } catch (e) {
      console.error('Completion error:', e);
      throw e;
    }
  }

  async stopCompletion() {
    if (this.llamaContext) {
      try { await this.llamaContext.stopCompletion(); } catch {}
    }
  }

  async release() {
    if (this.llamaContext) {
      try {
        if (this.visionEnabled) {
          try { await this.llamaContext.releaseMultimodal(); } catch {}
        }
        await this.llamaContext.release();
      } catch {}
      this.llamaContext = null;
      this.visionEnabled = false;
    }
  }
}

export const localLlamaService = new LocalLlamaService();
