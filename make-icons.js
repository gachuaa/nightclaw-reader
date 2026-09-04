/* Generates NightClaw app icons (PNG + ICO) from the claw logo — no deps */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* claw polygons in a 100x100 viewBox (same paths as the in-app SVG) */
const CLAWS = [
  [50,10, 55.5,33, 52.5,49, 50,54, 47.5,49, 44.5,33],
  [33,20, 42,39, 44.5,52, 36.5,49.5, 29.5,34],
  [67,20, 58,39, 55.5,52, 63.5,49.5, 70.5,34],
  [20,33, 29.5,45, 32,56, 23.5,51.5, 16.5,41],
  [80,33, 70.5,45, 68,56, 76.5,51.5, 83.5,41],
  [50,60, 80.5,76.5, 69,92.5, 50,87.5, 31,92.5, 19.5,76.5]
];
const AMBER = [0xf0, 0xb4, 0x5e];

/* ---------- geometry ---------- */
function inRounded(x, y, S, r){
  if (x < 0 || y < 0 || x >= S || y >= S) return false;
  const cx = Math.min(Math.max(x, r), S - r);
  const cy = Math.min(Math.max(y, r), S - r);
  const dx = x - cx, dy = y - cy;
  return dx*dx + dy*dy <= r*r;
}
function pip(x, y, p){
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i+1], xj = p[j], yj = p[j+1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}
function renderIcon(size){
  const buf = Buffer.alloc(size * size * 4);
  const s = size * 0.92 / 100, off = (size - 100 * s) / 2;
  const polys = CLAWS.map(p => p.map(v => v * s + off));
  const r = size * 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const px = x + (sx + .5) / 2, py = y + (sy + .5) / 2;
        if (inRounded(px, py, size, r)) {
          for (const p of polys) { if (pip(px, py, p)) { hit++; break; } }
        }
      }
      if (hit) {
        const o = (y * size + x) * 4;
        buf[o] = AMBER[0]; buf[o+1] = AMBER[1]; buf[o+2] = AMBER[2];
        buf[o+3] = Math.round(255 * hit / 4);
      }
    }
  }
  return buf;
}

/* ---------- PNG ---------- */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(buf){
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, rgba){
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; /* 8-bit RGBA */
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/* ---------- ICO (PNG-compressed entries, Vista+) ---------- */
function makeIco(){
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map(sz => ({ sz, png: encodePng(sz, sz, renderIcon(sz)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length);
  let offset = 6 + 16 * sizes.length;
  pngs.forEach((p, i) => {
    const o = i * 16;
    dir[o]   = p.sz >= 256 ? 0 : p.sz;
    dir[o+1] = p.sz >= 256 ? 0 : p.sz;
    dir.writeUInt16LE(1, o+4);  dir.writeUInt16LE(32, o+6);
    dir.writeUInt32LE(p.png.length, o+8);
    dir.writeUInt32LE(offset, o+12);
    offset += p.png.length;
  });
  return Buffer.concat([header, dir, ...pngs.map(p => p.png)]);
}

/* ---------- write everything ---------- */
const root = __dirname;
const iconsDir = path.join(root, 'build', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

fs.writeFileSync(path.join(root, 'build', 'icon.png'), encodePng(1024, 1024, renderIcon(1024)));
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), makeIco());
[16, 24, 32, 48, 64, 128, 256, 512].forEach(sz => {
  fs.writeFileSync(path.join(iconsDir, sz + 'x' + sz + '.png'), encodePng(sz, sz, renderIcon(sz)));
});
console.log('Icons written: build/icon.png (1024), build/icon.ico, build/icons/*.png');
