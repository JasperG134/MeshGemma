// Mac-host ("REMOTE") vision path: wraps a remote llama-server `/completion`
// call with the vision prompt and `image_data`. This is the optional fast path
// used when the Analysis LPU tab is set to REMOTE BASE STATION mode.
//
// On-device vision DOES ship in this build via `LocalLlamaService` — Gemma 4
// E2B + the mmproj-F16 projector run image+text inference directly on the phone
// over llama.rn's `media_paths` API when the LPU tab is set to LOCAL mode.
// This service only handles the Mac-host alternative.

const TIMEOUT_MS = 60_000;

// Default prompt used when ANALYZE is invoked from a feed photo card — fixed
// emergency-dispatcher schema so the result renders cleanly in
// PhotoIncidentCard.
const DEFAULT_ANALYZE_PROMPT = `<start_of_turn>user
You are an emergency response analyst. Describe what you see in this
photo as if reporting to a remote dispatcher who cannot see it.

Format your reply as:
- SCENE: <one sentence, ≤80 chars>
- HAZARDS: <comma-separated, or NONE>
- PEOPLE_VISIBLE: <count or NONE>
- URGENCY: <LOW|MEDIUM|HIGH|CRITICAL>

Be specific (smoke color, distance estimate, flame visibility, water
depth) but never invent details you cannot see.<end_of_turn>
<start_of_turn>model
`;

// Builds a free-form prompt when the user attaches a photo to the LPU chat
// and asks Gemma a custom question about it. Falls back to a generic
// "describe the scene" instruction if the user has no question yet.
function buildQuestionPrompt(question: string): string {
  const trimmed = question.trim();
  const userLine = trimmed.length > 0
    ? trimmed
    : 'Describe what you see in this photo. Be specific and only describe what is actually visible.';
  return `<start_of_turn>user
You are Gemma, an on-device AI assistant inside MeshGemma — a peer-to-peer
mesh app used in disaster scenarios. The user has attached a photo and
wants concrete, actionable help. Answer briefly. Never invent details you
cannot see in the photo.

Question: ${userLine}<end_of_turn>
<start_of_turn>model
`;
}

export type VisionAnalyzeOptions = {
  serverIp: string;
  imageB64: string;
  // Optional free-form question. When omitted, the default emergency-
  // dispatcher prompt is used (the path the feed photo card uses).
  question?: string;
  signal?: AbortSignal;
};

export type VisionResult = {
  text: string;
};

export class VisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionUnavailableError';
  }
}

export async function analyzePhoto(opts: VisionAnalyzeOptions): Promise<VisionResult> {
  const { serverIp, imageB64 } = opts;
  if (!serverIp) {
    throw new VisionUnavailableError('No base station configured.');
  }
  if (!imageB64 || imageB64.length === 0) {
    throw new Error('Empty image payload.');
  }

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Bridge external signal → our controller
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`http://${serverIp}:8080/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: typeof opts.question === 'string'
          ? buildQuestionPrompt(opts.question)
          : DEFAULT_ANALYZE_PROMPT,
        n_predict: 256,
        temperature: 0.3,
        top_p: 0.9,
        stop: ['<end_of_turn>', '<start_of_turn>', 'User:'],
        // llama-server's vision wire format: image_data is an array of
        // { data: <base64>, id: <int> } and the `[img-<id>]` token is
        // referenced inline. We omit the inline token here — the server
        // binds the image to the prompt automatically when there's exactly
        // one entry. (Tested against llama.cpp server commit ≥ 2024-Q4.)
        image_data: [{ data: imageB64, id: 1 }],
      }),
      signal: controller.signal as any,
    });
    if (!res.ok) {
      throw new Error(`Vision /completion failed: HTTP ${res.status}`);
    }
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Vision endpoint returned non-JSON response');
    }
    const content = typeof data?.content === 'string' ? data.content.trim() : '';
    if (!content) {
      throw new Error('Vision endpoint returned empty content');
    }
    return { text: content };
  } finally {
    clearTimeout(timeoutTimer);
  }
}
