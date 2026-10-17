import { strToU8, zipSync, zlibSync } from 'fflate';
import { bytesToDataUrl, createProject } from '../../src/core/project';
import { crc32 } from '../../src/core/validation/project';
import type { ArtworkLayer, ProjectDocument } from '../../src/types/project';

function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length); bytes.set(strToU8(type), 4); bytes.set(data, 8);
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, bytes.length - 4))); return bytes;
}

export function png(): Uint8Array {
  const header = new Uint8Array(13); const view = new DataView(header.buffer); view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6;
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(new Uint8Array([0, 200, 20, 80, 255]))), chunk('IEND', new Uint8Array())];
  const bytes = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0)); let offset = 0; for (const item of chunks) { bytes.set(item, offset); offset += item.length; } return bytes;
}

export function glb(): Uint8Array {
  const text = JSON.stringify({ asset: { version: '2.0', generator: 'STULOOMA independent fixture' }, buffers: [{ byteLength: 8 }] });
  const json = strToU8(text.padEnd(Math.ceil(text.length / 4) * 4, ' '));
  const bytes = new Uint8Array(12 + 8 + json.length + 8 + 8), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(json, 20);
  view.setUint32(20 + json.length, 8, true); view.setUint32(24 + json.length, 0x004e4942, true); bytes.set([1, 2, 3, 4, 5, 6, 7, 8], 28 + json.length);
  return bytes;
}

export function layer(regionId = 'FRONT', id = 'front-logo'): ArtworkLayer {
  return { id, name: '가슴 로고', type: 'image', regionId, assetId: 'logo', x: 0.3, y: 0.2, width: 0.25, height: 0.2, rotation: 12, opacity: 0.85, visible: true, locked: false };
}

export function project(): ProjectDocument {
  const p = createProject('tshirt'); p.name = '서울 유니폼 — 김수현';
  p.assets.logo = { id: 'logo', name: '투명 로고.png', mime: 'image/png', data: bytesToDataUrl(png(), 'image/png') };
  p.layers = [layer(), { ...layer('BACK', 'back-logo'), name: '등판 디자인', x: 0.5, rotation: -30 }];
  p.regions.FRONT!.color = '#221144'; p.regions.BACK!.roughness = 0.6;
  p.camera = { position: [2, 1, -4], target: [0, 0.1, 0] };
  p.metadata = { modelVersion: '1.0', author: '서울 의류 작업실', futureFeature: { enabled: true, tags: ['한글', 7] } };
  return p;
}

export function archive(manifest: unknown, files: Record<string, Uint8Array> = {}, level: 0 | 6 = 6): Uint8Array {
  return zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...files }, { level });
}

export function directoryOffset(bytes: Uint8Array): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(bytes.length - 6, true); }
