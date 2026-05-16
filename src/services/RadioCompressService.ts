import { localLlamaService } from './LocalLlamaService';
import type { Incident } from './MockDatabase';
import { byteLength } from '../utils/byteSize';

// Subset of AppContext.ChatMessage we actually need. We avoid importing the
// full type so this service stays free of context dependencies.
export type RadioChatMessage = {
  text: string;
  ts: number;
  shortId: string;
  displayName?: string;
};

export type AiComputeMode = 'remote' | 'local';

export type RadioPayload = {
  v: 1;
  n: number;
  med?: string[];
  haz?: string[];
  sup?: string[];
  loc?: [number, number];
  t: number;
  // arbitrary extra fields the model may emit; we don't reject them, we just
  // measure bytes and call it good.
  [k: string]: unknown;
};

export type CompressResult = {
  payload: RadioPayload;
  json: string;
  rawBytes: number;
  compressedBytes: number;
  ratio: number;
  attempts: number;
  retried: boolean;
  truncated: boolean;
};

export type CompressOptions = {
  mode: AiComputeMode;
  serverIp: string;
  feed: Incident[];
  // Optional peer-to-peer chat messages to include alongside incidents. They
  // get summarized as "[CHAT] from <name>: <text>" and contribute to the raw
  // byte counter and the prompt.
  chats?: RadioChatMessage[];
  // Optional cap (default 50). Falls back to all-feed if shorter.
  n?: number;
  // Byte budget, default 200.
  byteBudget?: number;
  // Hook for incremental token streaming (local mode only).
  onToken?: (t: string) => void;
};

const DEFAULT_N = 50;
const DEFAULT_BUDGET = 200;
const REMOTE_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = (n: number, budget: number, feedDump: string) => `<start_of_turn>user
You are a radio dispatcher. Compress these ${n} signed mesh records — both
incident reports and peer-to-peer chat messages — into a JSON payload of
≤${budget} bytes for transmission over a low-bandwidth radio link to
government emergency services. Use this exact schema:

{"v":1,"n":<incident_count>,"med":[<3-letter_codes_with_locs>],
 "haz":[<hazards_with_locs>],"sup":[<supply_needs>],
 "loc":[<center_lat>,<center_lng>],"t":<unix_minutes>}

Rules:
- Use 3-letter type codes (BRN=burn, FRX=fracture, MED=medical, FIR=fire, HAZ=hazard, SUP=supply, etc).
- Truncate location names to ≤8 chars.
- Round coordinates to 3 decimals.
- Output ONLY the JSON, no prose, no markdown fence.
- If you cannot fit, drop lowest-priority items first.

Incidents:
${feedDump}<end_of_turn>
<start_of_turn>model
`;

const RETIGHTEN_PROMPT = (oversize: number, budget: number, prevOutput: string) => `<start_of_turn>user
Output was ${oversize} bytes, must be ≤${budget}. Tighten by dropping
lower-priority items, shortening 3-letter codes, removing optional fields.
Output ONLY valid JSON, no prose. Previous attempt:
${prevOutput}<end_of_turn>
<start_of_turn>model
`;

// Combined summary: incidents first (most actionable), then chat messages
// (situational color). Both share the byte budget; we cap total at `n`.
function summarizeRecords(
  feed: Incident[],
  chats: RadioChatMessage[],
  n: number,
): string {
  const incidentLines = feed.slice(0, n).map((it) => {
    const loc = it.location
      ? `${it.location.lat.toFixed(3)},${it.location.lng.toFixed(3)}`
      : 'no-gps';
    const locName = (it.locationName || '').slice(0, 12);
    const msg = (it.message || '').replace(/\s+/g, ' ').slice(0, 80);
    return `- [${it.type}] ${locName} @ ${loc}: ${msg}`;
  });
  const remaining = Math.max(0, n - incidentLines.length);
  const chatLines = chats.slice(-remaining).map((c) => {
    const who = (c.displayName?.trim() || c.shortId || '?').slice(0, 12);
    const text = (c.text || '').replace(/\s+/g, ' ').slice(0, 80);
    return `- [chat] ${who}: ${text}`;
  });
  return [...incidentLines, ...chatLines].join('\n');
}

// Estimate raw byte size in the format we'd send if we didn't compress.
// Includes both incidents and chats so the "RAW FEED → COMPRESSED" counter
// reflects everything Gemma is actually being asked to crunch.
export function rawFeedBytes(
  feed: Incident[],
  n: number = DEFAULT_N,
  chats: RadioChatMessage[] = [],
): number {
  const incidents = feed.slice(0, n);
  const remaining = Math.max(0, n - incidents.length);
  const usedChats = chats.slice(-remaining);
  return byteLength(JSON.stringify({ incidents, chats: usedChats }));
}

// Try to extract a JSON object from a raw model response. Models sometimes
// wrap output in ```json fences or add chat boilerplate. Trims to the first
// `{` and the last `}` that brackets the JSON.
function extractJson(raw: string): string | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = raw.slice(start, end + 1).trim();
  return slice.length > 0 ? slice : null;
}

function parseAndValidate(raw: string): { payload: RadioPayload; json: string } | null {
  const candidate = extractJson(raw);
  if (!candidate) return null;
  try {
    const obj = JSON.parse(candidate);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    // Re-stringify in compact form to get a stable byte count.
    const compact = JSON.stringify(obj);
    return { payload: obj as RadioPayload, json: compact };
  } catch {
    return null;
  }
}

async function callRemote(
  serverIp: string,
  prompt: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const res = await fetch(`http://${serverIp}:8080/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        n_predict: 320,
        temperature: 0.2,
        top_p: 0.9,
        stop: ['<end_of_turn>', '<start_of_turn>', 'User:'],
      }),
      signal: controller.signal as any,
    });
    if (!res.ok) {
      throw new Error(`Remote /completion failed: HTTP ${res.status}`);
    }
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Remote /completion returned non-JSON response');
    }
    return typeof data?.content === 'string' ? data.content : '';
  } finally {
    clearTimeout(timer);
  }
}

async function callLocal(
  prompt: string,
  onToken?: (t: string) => void,
): Promise<string> {
  await localLlamaService.initModel();
  return localLlamaService.completion(prompt, onToken);
}

export class RadioCompressError extends Error {
  rawOutput: string;
  attempts: number;
  constructor(message: string, rawOutput: string, attempts: number) {
    super(message);
    this.name = 'RadioCompressError';
    this.rawOutput = rawOutput;
    this.attempts = attempts;
  }
}

export async function compressFeed(opts: CompressOptions): Promise<CompressResult> {
  const cap = opts.n ?? DEFAULT_N;
  const chats = opts.chats ?? [];
  const totalAvailable = opts.feed.length + chats.length;
  const n = Math.min(cap, totalAvailable);
  if (n === 0) {
    throw new RadioCompressError(
      'No incidents or chat messages to compress. Post one in the FEED tab or send a CHAT message first.',
      '',
      0,
    );
  }
  const budget = opts.byteBudget ?? DEFAULT_BUDGET;
  const dump = summarizeRecords(opts.feed, chats, n);
  const rawBytes = rawFeedBytes(opts.feed, n, chats);

  const runOnce = async (prompt: string): Promise<string> => {
    if (opts.mode === 'remote') {
      return callRemote(opts.serverIp, prompt);
    }
    return callLocal(prompt, opts.onToken);
  };

  let attempts = 0;
  let lastRaw = '';
  let result: { payload: RadioPayload; json: string } | null = null;

  // First attempt
  attempts += 1;
  lastRaw = await runOnce(SYSTEM_PROMPT(n, budget, dump));
  result = parseAndValidate(lastRaw);

  let oversized = false;
  if (result) {
    oversized = byteLength(result.json) > budget;
  }

  // One re-prompt if the first attempt was malformed OR oversized.
  if (!result || oversized) {
    attempts += 1;
    const oversize = result ? byteLength(result.json) : budget * 2;
    const tightenInput = result?.json ?? lastRaw.slice(0, 400);
    lastRaw = await runOnce(RETIGHTEN_PROMPT(oversize, budget, tightenInput));
    result = parseAndValidate(lastRaw);
    if (result) oversized = byteLength(result.json) > budget;
  }

  if (!result) {
    throw new RadioCompressError(
      'Model returned malformed JSON twice. See raw output for details.',
      lastRaw,
      attempts,
    );
  }

  const compressedBytes = byteLength(result.json);
  // We don't HARD-fail oversized — we surface it as a flag and let the UI
  // show the warning. Keeps the demo from getting stuck.
  const truncated = compressedBytes > budget;
  const ratio = compressedBytes > 0 ? rawBytes / compressedBytes : 0;

  return {
    payload: result.payload,
    json: result.json,
    rawBytes,
    compressedBytes,
    ratio,
    attempts,
    retried: attempts > 1,
    truncated,
  };
}

// Estimate LoRa SF7 BW125 airtime for the given byte payload. Static formula
// — not measured. Matches the spec line "Airtime: ~273 ms" for ~187 B. We use
// the simplified throughput approximation (~5470 bps useful) which is close
// enough for an on-screen estimate.
export function estimateLoraAirtimeMs(bytes: number): number {
  const usefulBps = 5470;
  return Math.round((bytes * 8 * 1000) / usefulBps);
}
