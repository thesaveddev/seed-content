import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { config } from '../../config/env';

/**
 * Public media for platforms that ingest by URL (Instagram, TikTok).
 *
 * Text-only posts can't go to these platforms as-is — they need an image.
 * We render a branded "card" (PNG, pure Node — zlib CRC math, no canvas
 * dependency) from the post text, store it under the public uploads dir,
 * and hand out a signed URL that the platform's servers can fetch.
 */

const MEDIA_TTL_S = 24 * 60 * 60; // signed URLs valid for 24h

function mediaDir(): string {
  const dir = path.resolve(process.cwd(), config.STORAGE_DIR || './uploads', 'media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Signing ──────────────────────────────────────────────────────

function signingKey(): string {
  return config.MEDIA_SIGNING_SECRET || `${config.JWT_SECRET}|seed-media-signing`;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function mediaPublicUrl(file: string, ttlS = MEDIA_TTL_S): string {
  const base = (config.PUBLIC_BASE_URL || `http://localhost:${config.PORT}`).replace(/\/$/, '');
  const expires = Math.floor(Date.now() / 1000) + ttlS;
  const sig = sign(`${file}:${expires}`);
  return `${base}/api/media/${encodeURIComponent(file)}?expires=${expires}&sig=${sig}`;
}

export function verifyMediaSignature(file: string, expires: string | undefined, sig: string | undefined): boolean {
  if (!expires || !sig) return false;
  const exp = Number.parseInt(expires, 10);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = sign(`${file}:${exp}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function resolveMediaPath(file: string): string | null {
  // Path-traversal guard: allow [A-Za-z0-9._-] only, no dirs, no ".."
  if (!/^[A-Za-z0-9._-]+$/.test(file) || file.includes('..')) return null;
  const full = path.join(mediaDir(), file);
  if (!fs.existsSync(full)) return null;
  return full;
}

// ── PNG encoding (zero-dependency) ───────────────────────────────

function crc32(buf: Buffer): number {
  let table = (crc32 as any).table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as any).table = table;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

// Brand palette (matches the web tokens — indigo family)
const BG: RGB = { r: 30, g: 27, b: 75 }; // deep indigo
const CARD: RGB = { r: 49, g: 46, b: 129 }; // indigo-900
const ACCENT: RGB = { r: 129, g: 140, b: 248 }; // indigo-400
const TEXT: RGB = { r: 237, g: 233, b: 254 }; // near-white
const MUTED: RGB = { r: 165, g: 180, b: 252 }; // indigo-300

const W = 1080;
const H = 1080;

function setPx(buf: Buffer, x: number, y: number, c: RGB) {
  const i = (y * W + x) * 3;
  buf[i] = c.r;
  buf[i + 1] = c.g;
  buf[i + 2] = c.b;
}

function fillRect(buf: Buffer, x0: number, y0: number, w: number, h: number, c: RGB) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) setPx(buf, x, y, c);
    }
  }
}

// 5x7 bitmap font — digits, A-Z and basic punctuation. Compact but legible.
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '"': ['01010', '01010', '00000', '00000', '00000', '00000', '00000'],
  '#': ['01010', '11111', '01010', '01010', '01010', '11111', '01010'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function drawText(buf: Buffer, text: string, x0: number, y0: number, scale: number, color: RGB): number {
  let x = x0;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (!glyph) {
      x += (GLYPH_W + 1) * scale; // unknown char → space
      continue;
    }
    for (let gy = 0; gy < GLYPH_H; gy++) {
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (glyph[gy][gx] === '1') {
          fillRect(buf, x + gx * scale, y0 + gy * scale, scale, scale, color);
        }
      }
    }
    x += (GLYPH_W + 1) * scale;
  }
  return x - x0;
}

function wrapWords(text: string, maxCols: number): string[] {
  const words = String(text || '').toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length <= maxCols) line = candidate;
    else {
      if (line) lines.push(line);
      line = w.slice(0, maxCols); // hard-break overlong words
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 8); // cap at 8 lines
}

export interface CardResult {
  file: string;
  filePath: string;
  text: string;
}

/**
 * Render a branded 1080x1080 image card for a text post.
 * Deterministic filename per content+platform so retries reuse the card.
 */
export function renderTextCard(text: string, platform: string, contentId: string): CardResult {
  const raw = String(text || '').trim().slice(0, 600) || 'New post';
  const scale = 3; // glyph pixel size
  const maxCols = Math.floor((W - 160) / ((GLYPH_W + 1) * scale)); // 160px side padding

  const lines = wrapWords(raw, maxCols);

  const buf = Buffer.alloc(W * H * 3);
  fillRect(buf, 0, 0, W, H, BG);

  // Decorative accent blocks (matches the landing identity)
  fillRect(buf, 60, 60, 220, 14, ACCENT);
  fillRect(buf, 60, 86, 120, 8, MUTED);

  // Platform badge (top-right)
  const plat = platform.toUpperCase().slice(0, 10);
  const platW = plat.length * (GLYPH_W + 1) * scale;
  fillRect(buf, W - 60 - platW - 20, 54, platW + 40, 62, CARD);
  drawText(buf, plat, W - 60 - platW, 66, scale, ACCENT);

  // Body text, vertically centered-ish
  const lineH = GLYPH_H * scale + 18;
  const startY = 280;
  lines.forEach((line, i) => {
    drawText(buf, line, 80, startY + i * lineH, scale, TEXT);
  });

  // Footer wordmark
  drawText(buf, 'SEED CONTENT', 80, H - 120, scale, MUTED);
  fillRect(buf, 80, H - 140, 380, 4, ACCENT);

  // Encode PNG
  const rawScanlines = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    rawScanlines[y * (1 + W * 3)] = 0; // filter: none
    buf.copy(rawScanlines, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(rawScanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  const file = `card-${platform}-${contentId}.png`;
  const filePath = path.join(mediaDir(), file);
  fs.writeFileSync(filePath, png);
  return { file, filePath, text: raw };
}
