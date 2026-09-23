// Small dependency-free MD5 implementation — used only for
// lib/gravatar.ts's hash-of-an-email lookup key, never for anything
// security-sensitive (MD5 is what Gravatar's own decade-old protocol
// requires, not a choice made here). Pure JS with no Node built-ins, so it
// works both server-side and in a "use client" component (components/
// Navbar.tsx), unlike Node's own crypto module, which only runs server-side.
export function md5(input: string): string {
  function rotateLeft(x: number, c: number) {
    return (x << c) | (x >>> (32 - c));
  }

  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const bytes = Array.from(new TextEncoder().encode(input));
  const originalLenBits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((originalLenBits / 2 ** (8 * i)) & 0xff);

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] =
        bytes[chunkStart + i * 4] |
        (bytes[chunkStart + i * 4 + 1] << 8) |
        (bytes[chunkStart + i * 4 + 2] << 16) |
        (bytes[chunkStart + i * 4 + 3] << 24);
    }

    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotateLeft(F, S[i])) | 0;
    }

    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  // MD5 output is little-endian per word.
  function toHexLE(num: number) {
    const bytes = [];
    for (let i = 0; i < 4; i++) bytes.push((num >>> (i * 8)) & 0xff);
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}
