'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crcBuf]);
}

function writePNG(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter: None
    raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * rowLen + 1);
  }

  const idat = zlib.deflateSync(raw, { level: 1 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// Colors
const BLUE = [26, 58, 107, 255];   // #1a3a6b
const RED  = [204, 0, 0, 255];     // #CC0000
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function fillPixels(size, fn) {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = fn(x, y, size);
      const i = (y * size + x) * 4;
      px[i] = color[0]; px[i+1] = color[1]; px[i+2] = color[2]; px[i+3] = color[3];
    }
  }
  return px;
}

function isCross(x, y, cx, cy, halfSpan, halfArm) {
  const inH = Math.abs(x - cx) <= halfSpan && Math.abs(y - cy) <= halfArm;
  const inV = Math.abs(x - cx) <= halfArm  && Math.abs(y - cy) <= halfSpan;
  return inH || inV;
}

function isBloodDrop(x, y, cx, bottom, size) {
  const r = size * 0.35;
  const cy = bottom - r;
  const tip = bottom - size;
  // circle (rounded bottom)
  if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
  // tapered upper half
  if (y < cy && y >= tip) {
    const halfW = r * (1 - (cy - y) / (cy - tip));
    if (Math.abs(x - cx) <= halfW) return true;
  }
  return false;
}

// icon.png: dark blue bg, red cross centered
function iconPixel(x, y, s) {
  const cx = s / 2;
  if (isCross(x, y, cx, cx, s * 0.27, s * 0.08)) return RED;
  return BLUE;
}

// android-icon-foreground.png: transparent bg, red cross
function fgPixel(x, y, s) {
  const cx = s / 2;
  if (isCross(x, y, cx, cx, s * 0.27, s * 0.08)) return RED;
  return CLEAR;
}

// android-icon-monochrome.png: white cross, transparent bg
function monoPixel(x, y, s) {
  const cx = s / 2;
  if (isCross(x, y, cx, cx, s * 0.27, s * 0.08)) return WHITE;
  return CLEAR;
}

// notification-icon.png: white cross, transparent bg
function notifPixel(x, y, s) {
  const cx = s / 2;
  if (isCross(x, y, cx, cx, s * 0.35, s * 0.11)) return WHITE;
  return CLEAR;
}

const ASSETS = path.join(__dirname, 'assets');

const tasks = [
  ['icon.png', 1024, iconPixel],
  ['android-icon-foreground.png', 1024, fgPixel],
  ['android-icon-monochrome.png', 1024, monoPixel],
  ['notification-icon.png', 96, notifPixel],
];

for (const [name, size, fn] of tasks) {
  process.stdout.write(`Generating ${name} (${size}x${size})... `);
  const px = fillPixels(size, fn);
  fs.writeFileSync(path.join(ASSETS, name), writePNG(size, px));
  console.log('done');
}

console.log('All icons generated.');
