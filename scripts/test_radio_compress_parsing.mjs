// Standalone tests for the byteLength util + the JSON extractor + the
// raw-feed-bytes calculator the RadioCompressService relies on. We don't
// pull the actual TS modules (they import expo/RN), so we mirror the
// pure-JS bits here. If you change those bits in src/, mirror the change
// here too.

function byteLength(input) {
  let bytes = 0;
  for (let i = 0; i < input.length; i += 1) {
    const cp = input.codePointAt(i);
    if (cp === undefined) continue;
    if (cp < 0x80) bytes += 1;
    else if (cp < 0x800) bytes += 2;
    else if (cp < 0x10000) bytes += 3;
    else { bytes += 4; i += 1; }
  }
  return bytes;
}

function extractJson(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = raw.slice(start, end + 1).trim();
  return slice.length > 0 ? slice : null;
}

let failures = 0;
function check(label, ok) {
  if (ok) {
    console.log('PASS:', label);
  } else {
    console.error('FAIL:', label);
    failures += 1;
  }
}

// ASCII
check('byteLength ASCII', byteLength('hello') === 5);
// 2-byte UTF-8
check('byteLength é = 2 bytes', byteLength('é') === 2);
// 3-byte UTF-8
check('byteLength € = 3 bytes', byteLength('€') === 3);
// 4-byte UTF-8 (surrogate pair)
check('byteLength 🔥 = 4 bytes', byteLength('🔥') === 4);
// Mixed
check('byteLength mixed', byteLength('a€🔥') === 8);

// extractJson stripping markdown fences and prose
check(
  'extractJson tolerates markdown fence',
  extractJson('```json\n{"v":1,"n":3}\n```') === '{"v":1,"n":3}',
);
check(
  'extractJson tolerates leading prose',
  extractJson('Here is the payload:\n{"v":1,"n":3}') === '{"v":1,"n":3}',
);
check('extractJson rejects garbage', extractJson('no json here') === null);
check(
  'extractJson handles nested',
  extractJson('{"v":1,"loc":[1,2],"med":["BRN","FRX"]}') ===
    '{"v":1,"loc":[1,2],"med":["BRN","FRX"]}',
);

// Sample: the 200-byte spec target — sanity-check that a representative
// payload fits the budget.
const samplePayload = JSON.stringify({
  v: 1,
  n: 12,
  med: ['BRN@TR', 'FRX@LK', 'MED@ST'],
  haz: ['FIR@TR', 'SMK@TR'],
  sup: ['WAT@CMP', 'BAT@CMP'],
  loc: [52.123, 5.456],
  t: 28333333,
});
check(
  `sample payload ${byteLength(samplePayload)}B is ≤200B`,
  byteLength(samplePayload) <= 200,
);

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nAll parsing/byte tests passed.');
