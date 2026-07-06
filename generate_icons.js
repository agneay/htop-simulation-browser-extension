const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// PNG CRC-32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createPng(width, height, drawFn) {
  const buffer = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    buffer[offset++] = 0; // Filter type 0
    for (let x = 0; x < width; x++) {
      const color = drawFn(x, y, width, height);
      buffer[offset++] = color.r;
      buffer[offset++] = color.g;
      buffer[offset++] = color.b;
      buffer[offset++] = color.a;
    }
  }
  
  const idatData = zlib.deflateSync(buffer);
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.write(String.fromCharCode(8, 6, 0, 0, 0), 8, 'binary'); // 8-bit RGBA
  
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', idatData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function drawTerminalIcon(x, y, w, h) {
  const isBorder = x === 0 || x === w - 1 || y === 0 || y === h - 1;
  const headerHeight = Math.max(2, Math.round(h * 0.2));
  const isHeader = y > 0 && y < headerHeight;
  
  if (isBorder) {
    return { r: 60, g: 64, b: 72, a: 255 }; // Border
  }
  if (isHeader) {
    return { r: 30, g: 32, b: 38, a: 255 }; // Header background
  }
  
  // Body background
  let color = { r: 10, g: 12, b: 16, a: 255 };
  
  // Normalize coordinates for drawing shapes
  const rx = x / w;
  const ry = y / h;
  
  // Draw green terminal prompt ">"
  // E.g., center-left area
  if (rx > 0.15 && rx < 0.35 && ry > 0.35 && ry < 0.75) {
    const dy = ry - 0.55;
    const dx = rx - 0.15;
    if (Math.abs(dy) <= dx * 0.9) {
      return { r: 40, g: 200, b: 120, a: 255 }; // Nice terminal green
    }
  }
  
  // Draw green cursor "_"
  if (rx > 0.4 && rx < 0.65 && ry > 0.65 && ry < 0.75) {
    return { r: 40, g: 200, b: 120, a: 255 }; // Green
  }
  
  // Draw mock window controls (red dot) in top-right
  if (isHeader && rx > 0.8 && rx < 0.92) {
    return { r: 230, g: 80, b: 80, a: 255 };
  }
  
  return color;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir);
}

const sizes = [16, 48, 128];
sizes.forEach(size => {
  const pngBuf = createPng(size, size, drawTerminalIcon);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, pngBuf);
  console.log(`Generated: ${outPath} (${size}x${size})`);
});
console.log('All icons generated successfully!');
