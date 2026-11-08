import { expect, test } from 'vitest';
import { PLACEHOLDER_IMG } from '../src/views/PrivRedactView';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++)
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

test('placeholder image is a structurally valid PNG', () => {
  const b64 = PLACEHOLDER_IMG.split('base64,')[1]!;
  const raw = Buffer.from(b64, 'base64');
  expect([...raw.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  let pos = 8;
  const seen: string[] = [];
  while (pos < raw.length) {
    const len = raw.readUInt32BE(pos);
    const type = raw.subarray(pos + 4, pos + 8).toString('ascii');
    const want = raw.readUInt32BE(pos + 8 + len);
    expect(crc32(raw.subarray(pos + 4, pos + 8 + len))).toBe(want);
    seen.push(type);
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  expect(seen[0]).toBe('IHDR');
  expect(seen).toContain('IDAT');
  expect(seen[seen.length - 1]).toBe('IEND');
  expect(pos).toBe(raw.length); // no trailing bytes
});
