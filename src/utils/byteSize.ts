// UTF-8 byte length of a string. We can't rely on TextEncoder being present on
// every Hermes / RN runtime config, so we walk the string and apply the
// standard UTF-8 encoding rules directly. Surrogate pairs are handled by
// codePointAt + the length skip.
export function byteLength(input: string): number {
  let bytes = 0;
  for (let i = 0; i < input.length; i += 1) {
    const cp = input.codePointAt(i);
    if (cp === undefined) continue;
    if (cp < 0x80) {
      bytes += 1;
    } else if (cp < 0x800) {
      bytes += 2;
    } else if (cp < 0x10000) {
      bytes += 3;
    } else {
      bytes += 4;
      i += 1; // skip the low surrogate
    }
  }
  return bytes;
}
