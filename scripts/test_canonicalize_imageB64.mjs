// Standalone Node test for the canonicalize+sign+verify round-trip with an
// `imageB64` field on the incident payload. Mirrors the canonicalize() in
// src/services/CryptoService.ts byte-for-byte. Run with:
//   node scripts/test_canonicalize_imageB64.mjs
//
// The point: confirm that adding `imageB64` to the InnerMessage data is fully
// covered by the existing alphabetical-sort canonicalizer, so signatures
// produced with the field also verify with the field.

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
  const base = {
    v: 1,
    pubKey: pubKeyB64,
    lamport,
    ts: 1700000000000,
    payload,
  };
  const canon = canonicalize(base);
  const sigBytes = nacl.sign.detached(naclUtil.decodeUTF8(canon), secretKey);
  return { ...base, sig: naclUtil.encodeBase64(sigBytes) };
}

function verify(envelope) {
  const canon = canonicalize({
    v: envelope.v,
    pubKey: envelope.pubKey,
    lamport: envelope.lamport,
    ts: envelope.ts,
    payload: envelope.payload,
  });
  const pub = naclUtil.decodeBase64(envelope.pubKey);
  const sig = naclUtil.decodeBase64(envelope.sig);
  return nacl.sign.detached.verify(naclUtil.decodeUTF8(canon), sig, pub);
}

const kp = nacl.sign.keyPair();
const pubB64 = naclUtil.encodeBase64(kp.publicKey);

const photoIncident = {
  id: 'abc-1',
  type: 'hazard',
  message: 'visible flames in the tree line',
  timestamp: 1700000000000,
  author: 'NODE-abcd1234',
  locationName: 'TREELINE',
  location: { lat: 52.123, lng: 5.456 },
  imageB64: 'AAAA' + 'BCDE'.repeat(100), // simulated base64 photo
};

// Sign with a payload assembled in one key order.
const env1 = sign({ kind: 'INCIDENT', data: photoIncident }, kp.secretKey, pubB64, 1);
const ok1 = verify(env1);
if (!ok1) {
  console.error('FAIL: round-trip verify with imageB64 returned false');
  process.exit(1);
}

// Reorder all keys (incl. imageB64 swapped earlier) → signature must still verify.
const reorderedIncident = {
  imageB64: photoIncident.imageB64,
  type: photoIncident.type,
  location: photoIncident.location,
  locationName: photoIncident.locationName,
  message: photoIncident.message,
  timestamp: photoIncident.timestamp,
  author: photoIncident.author,
  id: photoIncident.id,
};
const env2 = sign({ kind: 'INCIDENT', data: reorderedIncident }, kp.secretKey, pubB64, 1);
if (env2.sig !== env1.sig) {
  console.error('FAIL: same payload, different key order produced different signatures');
  process.exit(1);
}
const ok2 = verify(env2);
if (!ok2) {
  console.error('FAIL: verify returned false after key reorder');
  process.exit(1);
}

// Negative: tampering with imageB64 must invalidate the signature.
const tampered = JSON.parse(JSON.stringify(env1));
tampered.payload.data.imageB64 = tampered.payload.data.imageB64 + 'XX';
const okTampered = verify(tampered);
if (okTampered) {
  console.error('FAIL: tampered imageB64 still verified — signature is not covering the field');
  process.exit(1);
}

// Without imageB64: still signs+verifies (proves the field is optional).
const noPhoto = { ...photoIncident };
delete noPhoto.imageB64;
const env3 = sign({ kind: 'INCIDENT', data: noPhoto }, kp.secretKey, pubB64, 1);
if (!verify(env3)) {
  console.error('FAIL: incident without imageB64 failed verify');
  process.exit(1);
}

console.log('PASS: imageB64 round-trip + reorder + tamper-detect + omission tests all green.');
