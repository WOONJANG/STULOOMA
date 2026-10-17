/** All fixture artwork and garment geometry is authored here; no third-party models. */
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildGarment } from '../src/core/garments/index';
import { exportGLB } from '../src/core/export/glb';

// GLTFExporter uses the browser FileReader API even when its binary result is exported in Node.
if (typeof globalThis.FileReader === 'undefined') {
  class NodeFileReader {
    result: string | ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }).catch(() => this.onerror?.());
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(result => {
        this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;
        this.onloadend?.();
      }).catch(() => this.onerror?.());
    }
  }
  Object.defineProperty(globalThis, 'FileReader', { value: NodeFileReader, configurable: true });
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, bytes: Uint8Array) {
  const data = Buffer.from(bytes), tag = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, checksum]);
}

function png(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}

await Promise.all(['assets/models', 'samples/artwork', 'samples/invalid', 'public/models', 'public/samples'].map(path => mkdir(path, { recursive: true })));
for (const kind of ['tshirt', 'basketball'] as const) {
  const binary = await exportGLB(buildGarment(kind));
  await writeFile(`assets/models/${kind}.glb`, binary);
  await writeFile(`public/models/${kind}.glb`, binary);
  await writeFile(`samples/${kind}.glb`, binary);
}

const logo = png(256, 256, (x, y) => {
  // Original S monogram: a deliberately transparent background and three linked strokes.
  const upper = x >= 48 && x < 208 && y >= 42 && y < 78;
  const middle = x >= 48 && x < 208 && y >= 110 && y < 146;
  const lower = x >= 48 && x < 208 && y >= 178 && y < 214;
  const left = x >= 48 && x < 84 && y >= 62 && y < 130;
  const right = x >= 172 && x < 208 && y >= 126 && y < 194;
  return upper || middle || lower || left || right ? [15, 208, 180, 255] : [0, 0, 0, 0];
});
const checker = png(512, 512, (x, y) => {
  const border = x < 6 || y < 6 || x >= 506 || y >= 506;
  if (border) return [20, 25, 35, 255];
  const tile = (Math.floor(x / 64) + Math.floor(y / 64)) % 2;
  return tile ? [246, 131, 63, 220] : [235, 242, 248, 255];
});
await writeFile('samples/artwork/transparent-logo.png', logo);
await writeFile('samples/artwork/uv-checker.png', checker);
await writeFile('public/samples/transparent-logo.png', logo);
await writeFile('public/samples/uv-checker.png', checker);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="300" viewBox="0 0 700 300"><defs><linearGradient id="ink" x1="0" x2="1"><stop stop-color="#16d4b4"/><stop offset="1" stop-color="#418ff4"/></linearGradient></defs><rect x="8" y="8" width="684" height="284" rx="50" fill="none" stroke="url(#ink)" stroke-width="12"/><path d="M68 66h114v28H96v36h86v104H68v-28h86v-48H68z" fill="url(#ink)"/><text x="222" y="167" font-family="sans-serif" font-weight="800" font-size="58" fill="#172b3a">STULOOMA</text><text x="226" y="209" font-family="sans-serif" font-size="22" letter-spacing="6" fill="#172b3a">ORIGINAL STUDIO</text></svg>`;
await writeFile('samples/artwork/stulooma-badge.svg', svg);
await writeFile('public/samples/stulooma-badge.svg', svg);
const missingUV = buildGarment('tshirt');
missingUV.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.deleteAttribute('uv'); });
// Deliberately bypass the public exporter's valid-geometry guard for this negative fixture.
const invalidBinary = await new GLTFExporter().parseAsync(missingUV, { binary: true });
await writeFile('samples/invalid/no-uv.glb', new Uint8Array(invalidBinary as ArrayBuffer));
await writeFile('samples/invalid/damaged.glb', new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 64, 0, 0, 0]));
console.log('Generated original garment GLBs, transparent artwork, UV checker, and invalid fixtures.');
