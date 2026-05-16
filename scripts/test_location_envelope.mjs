// Standalone Node test for the LOCATION envelope: sign+verify, key-order
// invariance, tamper-detection, and a simulated multi-hop relay where the
// same envelope arrives twice and dedup absorbs it.
//
// Run: node scripts/test_location_envelope.mjs

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

function canonicalize(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (t === 'string' || t === 'boolean') return JSON.stringify(value);
  if (t === 'undefined' || t === 'function' || t === 'symbol') return 'null';
  if (Array.isArray(value)) {
    const parts = [];
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
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    const v = value[k];
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
    parts.push(`${JSON.stringify(k)}:${canonicalize(v)}`);
  }
  return `{${parts.join(',')}}`;
}

function sign(payload, secretKey, pubKeyB64, lamport) {
  const base = { v: 1, pubKey: pubKeyB64, lamport, ts: 1700000000000, payload };
  const canon = canonicalize(base);
  const sig = nacl.sign.detached(naclUtil.decodeUTF8(canon), secretKey);
  return { ...base, sig: naclUtil.encodeBase64(sig) };
}

function verify(env) {
  const canon = canonicalize({
    v: env.v, pubKey: env.pubKey, lamport: env.lamport, ts: env.ts, payload: env.payload,
  });
  const pub = naclUtil.decodeBase64(env.pubKey);
  const sig = naclUtil.decodeBase64(env.sig);
  return nacl.sign.detached.verify(naclUtil.decodeUTF8(canon), sig, pub);
}

let failures = 0;
function check(label, ok) {
  console.log((ok ? 'PASS:' : 'FAIL:'), label);
  if (!ok) failures += 1;
}

const kpA = nacl.sign.keyPair();
const pubA = naclUtil.encodeBase64(kpA.publicKey);

// Phone D's signed location
const locPayload = { lat: 52.123, lng: 5.456, displayName: 'Demo Peer', accuracy: 8 };
const inner = { kind: 'LOCATION', data: locPayload };
const env = sign(inner, kpA.secretKey, pubA, 42);

// Round-trip verify
check('LOCATION sign+verify', verify(env));

// Key-order invariance
const reorderedInner = {
  data: { displayName: locPayload.displayName, lat: locPayload.lat, lng: locPayload.lng, accuracy: locPayload.accuracy },
  kind: 'LOCATION',
};
const env2 = sign(reorderedInner, kpA.secretKey, pubA, 42);
check('signature stable across key reorder', env2.sig === env.sig);

// Tamper detection on lat
const tampered = JSON.parse(JSON.stringify(env));
tampered.payload.data.lat = 0;
check('tampered lat fails verify', !verify(tampered));

// Multi-hop relay simulation: phone A→B→C→D, B forwards env from A to C and
// also accidentally bounces it back to A. The forwarding-seen dedup uses the
// (pubKey, lamport) tuple. Simulate that: a Set of seen keys.
const seen = new Set();
function key(e) { return `${e.pubKey}:${e.lamport}`; }
function deliver(e, label) {
  if (!verify(e)) return `${label}: rejected (bad sig)`;
  if (seen.has(key(e))) return `${label}: skipped (dedup hit)`;
  seen.add(key(e));
  return `${label}: applied`;
}
const r1 = deliver(env, 'first arrival via B→C path');
const r2 = deliver(env, 'second arrival via B→D→C bounce');
check('multi-hop dedup: first applied', r1.endsWith('applied'));
check('multi-hop dedup: second skipped', r2.endsWith('skipped (dedup hit)'));

// CATCHUP semantics: a relay sends the same envelope inside a CATCHUP bundle.
// The wrapping envelope has a different (pubKey, lamport) — it's signed by
// the relay node — but the inner envelope's (pubKey, lamport) is still the
// original sender's, so dedup still suppresses redelivery.
const kpB = nacl.sign.keyPair();
const pubB = naclUtil.encodeBase64(kpB.publicKey);
const catchupEnv = sign({ kind: 'CATCHUP', data: { envelopes: [env] } }, kpB.secretKey, pubB, 1);
check('CATCHUP wrapper signs+verifies', verify(catchupEnv));
const innerCatchup = catchupEnv.payload.data.envelopes[0];
const r3 = deliver(innerCatchup, 'arrival via CATCHUP bundle');
check('CATCHUP-relayed dup is dedup', r3.endsWith('skipped (dedup hit)'));

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nAll LOCATION-envelope mesh-relay tests passed.');
