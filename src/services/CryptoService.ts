// Must come before any tweetnacl import so nacl picks up the RN PRNG polyfill.
import 'react-native-get-random-values';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import AsyncStorage from '@react-native-async-storage/async-storage';

const __cryptoOk =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { crypto?: { getRandomValues?: unknown } }).crypto?.getRandomValues === 'function';
if (!__cryptoOk) {
  // Hard-fail loud so we don't silently produce a zero-entropy key.
  throw new Error('CryptoService: react-native-get-random-values polyfill missing');
}

export type Identity = {
  pubKey: string;
  shortId: string;
};

export type SignedEnvelope<T = unknown> = {
  v: 1;
  pubKey: string;
  lamport: number;
  ts: number;
  payload: T;
  sig: string;
};

const STORAGE_KEY = '@meshgemma:identity:v1';
const LAMPORT_STORAGE_KEY = '@meshgemma:lamport:v1';
const LAMPORT_PERSIST_DEBOUNCE_MS = 100;
// Crash-safety reserve. On boot we jump our in-memory lamport this far ahead of
// the last persisted value so a crash that loses an unflushed write window
// can't make us reuse a (pubKey, lamport) pair another peer has already seen.
// Set high enough that no realistic burst can exhaust it before persist lands.
const LAMPORT_BOOT_RESERVE = 1000;

type StoredKeyMaterial = {
  pub: string;
  sec: string;
};

const NOT_INITIALIZED = 'CryptoService.init() not awaited';

// NOTE: The canonicalizer below produces a stable, sorted-key serialization for
// any JSON-shaped payload. This is a wire-format break vs. the previous
// hand-rolled canonicalizer — both peers MUST run this version to verify each
// other's signatures, since semantically-equal payloads serialized by the old
// canonicalizer will not byte-match the new one.
class CryptoServiceImpl {
  private publicKey: Uint8Array | null = null;
  private secretKey: Uint8Array | null = null;
  private identity: Identity | null = null;
  private lamport = 0;
  private initPromise: Promise<Identity> | null = null;
  private lamportPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private lamportPersistPending = false;

  init(): Promise<Identity> {
    if (this.identity) {
      return Promise.resolve(this.identity);
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.loadOrGenerate().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async loadOrGenerate(): Promise<Identity> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    let identity: Identity | null = null;
    if (raw) {
      identity = this.tryLoadIdentity(raw);
    }
    if (!identity) {
      identity = await this.generateAndPersist();
    }
    // Load persisted lamport (best-effort; defaults to 0 on any failure).
    await this.loadLamport();
    return identity;
  }

  /**
   * Attempts to hydrate the in-memory keypair/identity from a stored blob.
   * Returns null on any corruption — the caller should fall through to
   * generateAndPersist() so the user gets a fresh identity rather than a
   * permanent boot loop.
   */
  private tryLoadIdentity(raw: string): Identity | null {
    let parsed: StoredKeyMaterial;
    try {
      parsed = JSON.parse(raw) as StoredKeyMaterial;
    } catch (e) {
      console.warn('CryptoService: stored identity is not valid JSON; regenerating', e);
      return null;
    }
    if (!parsed || typeof parsed.pub !== 'string' || typeof parsed.sec !== 'string') {
      console.warn('CryptoService: stored identity missing pub/sec; regenerating');
      return null;
    }
    let pub: Uint8Array;
    let sec: Uint8Array;
    try {
      pub = naclUtil.decodeBase64(parsed.pub);
      sec = naclUtil.decodeBase64(parsed.sec);
    } catch (e) {
      console.warn('CryptoService: stored identity base64 decode failed; regenerating', e);
      return null;
    }
    if (pub.length !== nacl.sign.publicKeyLength || sec.length !== nacl.sign.secretKeyLength) {
      console.warn('CryptoService: stored identity has wrong key length; regenerating');
      return null;
    }
    this.publicKey = pub;
    this.secretKey = sec;
    this.identity = this.buildIdentity(parsed.pub);
    return this.identity;
  }

  private async loadLamport(): Promise<void> {
    let rawLamport: string | null = null;
    try {
      rawLamport = await AsyncStorage.getItem(LAMPORT_STORAGE_KEY);
    } catch (e) {
      console.warn('CryptoService: lamport read failed; defaulting to 0', e);
      this.lamport = 0;
      return;
    }
    let base = 0;
    if (rawLamport != null) {
      const parsed = parseInt(rawLamport, 10);
      if (Number.isFinite(parsed) && !Number.isNaN(parsed) && parsed >= 0) {
        base = parsed;
      } else {
        console.warn('CryptoService: lamport parseInt failed; defaulting to 0');
      }
    }
    // Jump ahead by the boot reserve so a crash that lost the last persist
    // window can't make us reuse (pubKey, lamport).
    this.lamport = base + LAMPORT_BOOT_RESERVE;
    // Persist the new high-water mark immediately (best-effort) so two
    // back-to-back boots don't keep stacking the reserve.
    this.schedulePersistLamport();
  }

  private async generateAndPersist(): Promise<Identity> {
    const kp = nacl.sign.keyPair();
    const pubB64 = naclUtil.encodeBase64(kp.publicKey);
    const secB64 = naclUtil.encodeBase64(kp.secretKey);
    const stored: StoredKeyMaterial = { pub: pubB64, sec: secB64 };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    this.publicKey = kp.publicKey;
    this.secretKey = kp.secretKey;
    this.identity = this.buildIdentity(pubB64);
    return this.identity;
  }

  private buildIdentity(pubB64: string): Identity {
    return {
      pubKey: pubB64,
      shortId: pubB64.slice(0, 8),
    };
  }

  /**
   * Trailing-edge debounce: each call schedules a write 500ms out unless one is
   * already pending; the timer always picks up the latest in-memory value when
   * it fires. We do not block sign() on the I/O.
   */
  private schedulePersistLamport(): void {
    this.lamportPersistPending = true;
    if (this.lamportPersistTimer != null) {
      return;
    }
    this.lamportPersistTimer = setTimeout(() => {
      this.lamportPersistTimer = null;
      if (!this.lamportPersistPending) {
        return;
      }
      this.lamportPersistPending = false;
      const value = this.lamport;
      AsyncStorage.setItem(LAMPORT_STORAGE_KEY, String(value)).catch((e) => {
        console.warn('CryptoService: lamport persist failed', e);
      });
    }, LAMPORT_PERSIST_DEBOUNCE_MS);
  }

  getIdentity(): Identity {
    if (!this.identity) {
      throw new Error(NOT_INITIALIZED);
    }
    return this.identity;
  }

  sign<T>(payload: T): SignedEnvelope<T> {
    if (!this.identity || !this.secretKey) {
      throw new Error(NOT_INITIALIZED);
    }
    this.lamport += 1;
    const base = {
      v: 1 as const,
      pubKey: this.identity.pubKey,
      lamport: this.lamport,
      ts: Date.now(),
      payload,
    };
    const canonical = canonicalize(base);
    const sigBytes = nacl.sign.detached(naclUtil.decodeUTF8(canonical), this.secretKey);
    const sig = naclUtil.encodeBase64(sigBytes);
    this.schedulePersistLamport();
    return { ...base, sig };
  }

  verify<T>(envelope: SignedEnvelope<T>): boolean {
    if (!envelope || envelope.v !== 1) {
      return false;
    }
    if (
      typeof envelope.pubKey !== 'string' ||
      typeof envelope.sig !== 'string' ||
      typeof envelope.lamport !== 'number' ||
      typeof envelope.ts !== 'number'
    ) {
      return false;
    }
    let pub: Uint8Array;
    let sig: Uint8Array;
    try {
      pub = naclUtil.decodeBase64(envelope.pubKey);
      sig = naclUtil.decodeBase64(envelope.sig);
    } catch (e) {
      return false;
    }
    if (pub.length !== nacl.sign.publicKeyLength) {
      return false;
    }
    if (sig.length !== nacl.sign.signatureLength) {
      return false;
    }
    const canonical = canonicalize({
      v: envelope.v,
      pubKey: envelope.pubKey,
      lamport: envelope.lamport,
      ts: envelope.ts,
      payload: envelope.payload,
    });
    let ok = false;
    try {
      ok = nacl.sign.detached.verify(naclUtil.decodeUTF8(canonical), sig, pub);
    } catch (e) {
      return false;
    }
    if (ok) {
      const next = Math.max(this.lamport, envelope.lamport) + 1;
      if (next !== this.lamport) {
        this.lamport = next;
        this.schedulePersistLamport();
      }
    }
    return ok;
  }

  getLamport(): number {
    return this.lamport;
  }

  async rotate(): Promise<Identity> {
    await AsyncStorage.removeItem(STORAGE_KEY);
    this.publicKey = null;
    this.secretKey = null;
    this.identity = null;
    this.initPromise = null;
    // Reset lamport synchronously and persist 0 BEFORE generating the new
    // identity, so a fresh identity always starts from clock=0 even if the
    // process dies between rotate() and the next sign().
    this.lamport = 0;
    if (this.lamportPersistTimer != null) {
      clearTimeout(this.lamportPersistTimer);
      this.lamportPersistTimer = null;
    }
    this.lamportPersistPending = false;
    await AsyncStorage.setItem(LAMPORT_STORAGE_KEY, '0');
    return this.generateAndPersist();
  }
}

/**
 * Recursive sorted-key canonicalizer. Produces identical bytes for
 * semantically-equal payloads regardless of how the producer constructed them.
 *
 * - primitives (string/number/boolean/null) → JSON.stringify
 * - arrays → "[" + canonical(items).join(",") + "]"  (undefined item → "null", per JSON.stringify)
 * - objects → keys sorted alphabetically; undefined values are OMITTED (per JSON.stringify)
 *
 * NOTE: This is a wire-format break vs. the previous hand-rolled canonicalizer.
 * Peers running an older version cannot verify signatures produced here and
 * vice versa — both peers must run this version.
 */
function canonicalize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const t = typeof value;
  if (t === 'number') {
    // JSON.stringify handles non-finite by emitting "null" — match that.
    return Number.isFinite(value as number) ? JSON.stringify(value) : 'null';
  }
  if (t === 'string' || t === 'boolean') {
    return JSON.stringify(value);
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    // Top-level undefined has no JSON form; callers should not hit this path
    // because we drop undefined object values and substitute "null" in arrays
    // before recursing. Fall back to "null" to stay defensive.
    return 'null';
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        parts.push('null');
      } else {
        parts.push(canonicalize(item));
      }
    }
    return `[${parts.join(',')}]`;
  }
  // Plain object.
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') {
      // Match JSON.stringify: omit the key entirely.
      continue;
    }
    parts.push(`${JSON.stringify(k)}:${canonicalize(v)}`);
  }
  return `{${parts.join(',')}}`;
}

export type CryptoService = CryptoServiceImpl;
export const cryptoService: CryptoServiceImpl = new CryptoServiceImpl();
