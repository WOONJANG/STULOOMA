import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { importGLB, GLB_LIMITS } from '../../src/core/import/glb';
import { exportGLB } from '../../src/core/export/glb';

type Json = Record<string, any>;

// GLTFExporter uses this browser primitive; Blob itself is provided by Node.
beforeAll(() => {
  if (typeof globalThis.FileReader !== 'undefined') return;
  class TestFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }).catch(() => this.onerror?.());
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(value => {
        this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;
        this.onloadend?.();
      }).catch(() => this.onerror?.());
    }
  }
  Object.defineProperty(globalThis, 'FileReader', { value: TestFileReader, configurable: true });
});

function document(): { json: Json; binary: Uint8Array } {
  const binary = new Uint8Array(104);
  new Float32Array(binary.buffer, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Float32Array(binary.buffer, 36, 9).set([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  new Float32Array(binary.buffer, 72, 6).set([0, 0, 1, 0, 0, 1]);
  new Uint16Array(binary.buffer, 96, 3).set([0, 1, 2]);
  return { binary, json: {
    asset: { version: '2.0' }, scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Front', extras: { regionId: 'front', meshId: 'custom-front' } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 }] }],
    buffers: [{ byteLength: 102 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }, { buffer: 0, byteOffset: 72, byteLength: 24 }, { buffer: 0, byteOffset: 96, byteLength: 6 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  } };
}

function encode(json: Json, binary: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(text, 20);
  view.setUint32(20 + jsonLength, binaryLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(binary, 28 + jsonLength);
  return bytes;
}

function fixture(change?: (json: Json, binary: Uint8Array) => void): Uint8Array {
  const { json, binary } = document();
  change?.(json, binary);
  return encode(json, binary);
}

describe('safe GLB import', () => {
  it('imports geometry and stable region/mesh metadata, including subarray inputs', async () => {
    const bytes = fixture();
    const padded = new Uint8Array(bytes.length + 9);
    padded.set(bytes, 5);
    const model = await importGLB(padded.subarray(5, 5 + bytes.length));
    expect(model.meshes).toEqual([{ id: 'custom-front', name: 'Front', triangles: 1 }]);
    expect(model.group.getObjectByName('Front')?.userData.regionId).toBe('front');
    expect(model.warnings).toEqual([]);
  });

  it('creates unique deterministic names and IDs for duplicate meshes', async () => {
    const bytes = fixture(json => {
      json.nodes.push({ mesh: 0, name: 'Front', extras: { meshId: 'custom-front' } });
      json.scenes[0].nodes.push(1);
    });
    const first = await importGLB(bytes);
    const second = await importGLB(bytes);
    expect(new Set(first.meshes.map(mesh => mesh.name)).size).toBe(2);
    expect(new Set(first.meshes.map(mesh => mesh.id)).size).toBe(2);
    expect(first.meshes).toEqual(second.meshes);
  });

  it.each([
    ['external buffers', (json: Json) => { json.buffers[0].uri = 'https://example.invalid/model.bin'; }, /URI resources/],
    ['external extension resources', (json: Json) => { json.extensions = { CUSTOM: { schemaUri: 'https://example.invalid/schema' } }; }, /URI resources/],
    ['missing UVs', (json: Json) => { delete json.meshes[0].primitives[0].attributes.TEXCOORD_0; }, /UV coordinates/],
    ['missing normals', (json: Json) => { delete json.meshes[0].primitives[0].attributes.NORMAL; }, /normals/],
    ['unsupported extensions', (json: Json) => { json.extensionsRequired = ['KHR_draco_mesh_compression']; }, /required extension/],
    ['out-of-range accessor', (json: Json) => { json.accessors[0].count = 99; }, /exceeds its buffer view/],
    ['cycles', (json: Json) => { json.nodes[0].children = [0]; }, /cycle/],
    ['invalid transforms', (json: Json) => { json.nodes[0].translation = ['broken', 0, 0]; }, /invalid translation/],
    ['too many draws', (json: Json) => { json.meshes[0].primitives = Array.from({ length: GLB_LIMITS.drawCalls + 1 }, () => json.meshes[0].primitives[0]); }, /safety limits/],
  ] as const)('rejects %s before loading', async (_label, change, message) => {
    await expect(importGLB(fixture(change))).rejects.toThrow(message);
  });

  it('rejects invalid indices and non-finite geometry', async () => {
    await expect(importGLB(fixture((_json, binary) => new Uint16Array(binary.buffer, 96, 3).set([0, 1, 99])))).rejects.toThrow(/missing vertex/);
    await expect(importGLB(fixture((_json, binary) => new Float32Array(binary.buffer, 0, 9)[0] = NaN))).rejects.toThrow(/non-finite/);
  });

  it('rejects excessive embedded image dimensions before texture decoding', async () => {
    const bytes = fixture((json, binary) => {
      const image = binary.subarray(36, 69);
      image.fill(0);
      image.set([137, 80, 78, 71, 13, 10, 26, 10]);
      const header = new DataView(image.buffer, image.byteOffset, image.byteLength);
      header.setUint32(8, 13);
      header.setUint32(12, 0x49484452);
      header.setUint32(16, 100_000);
      header.setUint32(20, 100_000);
      json.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 33 });
      json.images = [{ bufferView: 4, mimeType: 'image/png' }];
    });
    await expect(importGLB(bytes)).rejects.toThrow(/image-dimension limit/);
  });

  it('rejects wrong headers, truncated chunks, and wrong versions', async () => {
    const magic = fixture();
    magic[0] = 0;
    await expect(importGLB(magic)).rejects.toThrow(/not a binary/);
    await expect(importGLB(fixture().subarray(0, 30))).rejects.toThrow(/length/);
    const version = fixture();
    new DataView(version.buffer).setUint32(4, 1, true);
    await expect(importGLB(version)).rejects.toThrow(/version 2/);
    const chunk = fixture();
    new DataView(chunk.buffer).setUint32(12, chunk.length, true);
    await expect(importGLB(chunk)).rejects.toThrow(/chunk/);
  });
});

describe('GLB export', () => {
  it('round-trips positions, normals, UVs, indices, and region IDs', async () => {
    const original = await importGLB(fixture());
    const exported = await exportGLB(original.group);
    expect(new DataView(exported.buffer).getUint32(0, true)).toBe(0x46546c67);
    const restored = await importGLB(exported);
    expect(restored.meshes[0].id).toBe('custom-front');
    const before = original.group.getObjectByName('Front') as THREE.Mesh;
    const after = restored.group.getObjectByName('Front') as THREE.Mesh;
    for (const attribute of ['position', 'normal', 'uv']) {
      expect(Array.from(after.geometry.getAttribute(attribute).array)).toEqual(Array.from(before.geometry.getAttribute(attribute).array));
    }
    expect(Array.from(after.geometry.index!.array)).toEqual(Array.from(before.geometry.index!.array));
    expect(after.userData.regionId).toBe('front');
  });

  it('rejects empty or untexturable geometry clearly', async () => {
    await expect(exportGLB(new THREE.Group())).rejects.toThrow(/no garment meshes/);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))));
    await expect(exportGLB(group)).rejects.toThrow(/UV coordinates/);
  });
});
