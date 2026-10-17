import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const size = 256;
const pixels = Buffer.alloc(size * size * 4);
const colors = {
  green: [40, 93, 67, 255],
  gold: [214, 181, 116, 255],
  ivory: [246, 244, 232, 255],
};

function distanceToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const radius = Math.hypot(x - 128, y - 128);
    let color = radius < 119 ? colors.green : [0, 0, 0, 0];
    if (radius > 105 && radius < 111) color = colors.gold;
    const lines = [
      distanceToSegment(x, y, 91, 68, 91, 188),
      distanceToSegment(x, y, 96, 128, 166, 70),
      distanceToSegment(x, y, 101, 128, 166, 186),
    ];
    if (Math.min(...lines) < 10) color = colors.ivory;
    pixels.set(color, (y * size + x) * 4);
  }
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const scanlines = Buffer.alloc(size * (1 + size * 4));
for (let y = 0; y < size; y++) {
  const rowOffset = y * (1 + size * 4);
  pixels.copy(scanlines, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', header),
  pngChunk('IDAT', deflateSync(scanlines)),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const iconHeader = Buffer.alloc(22);
iconHeader.writeUInt16LE(0, 0);
iconHeader.writeUInt16LE(1, 2);
iconHeader.writeUInt16LE(1, 4);
iconHeader[6] = 0;
iconHeader[7] = 0;
iconHeader.writeUInt16LE(1, 10);
iconHeader.writeUInt16LE(32, 12);
iconHeader.writeUInt32LE(png.length, 14);
iconHeader.writeUInt32LE(iconHeader.length, 18);

const iconPath = resolve(projectRoot, 'assets', 'kama-ledger.ico');
await mkdir(dirname(iconPath), { recursive: true });
await writeFile(iconPath, Buffer.concat([iconHeader, png]));
console.log(`Generated ${iconPath}`);