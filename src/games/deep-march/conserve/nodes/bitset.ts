/**
 * Node-id bitset ⇄ base64 (the save's generation.harvested, design doc §10.1):
 * bit i of byte ⌊id / 8⌋ (LSB first), trailing zero bytes dropped, standard
 * base64 with padding. Own codec (no btoa / Buffer): pure, the same everywhere.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += left > 1 ? ALPHABET[(n >> 6) & 63] : "=";
    out += left > 2 ? ALPHABET[n & 63] : "=";
  }
  return out;
}

/** Null when `text` is not canonical-length base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - pad);
  for (let i = 0, o = 0; i < text.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const c = text[i + j];
      const v = c === "=" && i + j >= text.length - pad ? 0 : INDEX.get(c);
      if (v === undefined) return null;
      n = (n << 6) | v;
    }
    for (let j = 0; j < 3 && o < bytes.length; j++) bytes[o++] = (n >> (16 - 8 * j)) & 255;
  }
  return bytes;
}

export function encodeIdSet(ids: Iterable<number>): string {
  let max = -1;
  for (const id of ids) if (id > max) max = id;
  const bytes = new Uint8Array(max < 0 ? 0 : (max >> 3) + 1);
  for (const id of ids) bytes[id >> 3] |= 1 << (id & 7);
  return bytesToBase64(bytes);
}

/** Null when `text` is not base64. */
export function decodeIdSet(text: string): Set<number> | null {
  const bytes = base64ToBytes(text);
  if (!bytes) return null;
  const ids = new Set<number>();
  bytes.forEach((b, i) => {
    for (let bit = 0; bit < 8; bit++) if (b & (1 << bit)) ids.add(i * 8 + bit);
  });
  return ids;
}
