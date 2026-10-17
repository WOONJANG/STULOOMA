import { describe, expect, it } from 'vitest';
import { createProject, dataUrlToBytes, loadProject, saveProject, validateProject, bytesToDataUrl } from '../../src/core/project';
import { History } from '../../src/core/history';
import { archive, glb, png, project } from '../security/fixtures';

describe('STULOOMA project data preservation', () => {
  it('creates valid independent front and back template regions', () => {
    for (const kind of ['tshirt', 'basketball'] as const) {
      const p = createProject(kind); expect(validateProject(p)).toEqual(p); expect(p.regions.FRONT).toBeDefined(); expect(p.regions.BACK).toBeDefined();
      expect(p.id).not.toBe(createProject(kind).id);
    }
  });
  it('round-trips Korean names, front/back designs, transforms, materials, camera and unknown optional metadata', async () => {
    const original = project(); const bytes = await saveProject(original); const restored = await loadProject(bytes);
    expect(restored).toEqual(original); expect(restored.layers.map((item) => item.regionId)).toEqual(['FRONT', 'BACK']);
    expect(dataUrlToBytes(restored.assets.logo!.data, 'image/png')).toEqual(png());
    expect(await loadProject(await saveProject(restored))).toEqual(original);
  });
  it('preserves untouched custom GLB bytes and mesh region mappings', async () => {
    const p = project(), bytes = glb(); p.garment = { kind: 'custom', name: '사용자 농구 저지', assetId: 'model', regionMeshes: { FRONT: ['BodyFront'], BACK: ['BodyBack'] } };
    p.assets.model = { id: 'model', name: '독립 모델.glb', mime: 'model/gltf-binary', data: bytesToDataUrl(bytes, 'model/gltf-binary') };
    const restored = await loadProject(await saveProject(p)); expect(restored).toEqual(p); expect(dataUrlToBytes(restored.assets.model!.data, 'model/gltf-binary')).toEqual(bytes);
  });
  it('accepts uncompressed containers with validated contents', async () => {
    const p = createProject(); expect(await loadProject(archive(p, {}, 0))).toEqual(p);
  });
  it('validates without mutating the caller', () => {
    const p = project(), validated = validateProject(p); validated.layers[0]!.x = 0.9; expect(p.layers[0]!.x).toBe(0.3);
  });
  it('supports editable Korean text and preserves hidden/locked layers', async () => {
    const p = project(); p.layers.push({ id: 'player', name: '선수 이름', type: 'text', text: '김수현 23', color: '#ffffff', fontSize: 0.08, regionId: 'BACK', x: 0.5, y: 0.4, width: 0.6, height: 0.15, rotation: 0, opacity: 1, visible: false, locked: true });
    expect(await loadProject(await saveProject(p))).toEqual(p);
  });
});

describe('bounded undo / redo history', () => {
  it('restores deleted artwork and multiple steps', () => {
    const p = project(), history = new History(p); const second = structuredClone(p); second.layers = [];
    history.push(second); history.push({ ...second, name: '다음 작업' });
    expect(history.undo()).toEqual(second); expect(history.undo()).toEqual(p); expect(history.undo()).toBeUndefined();
    expect(history.redo()).toEqual(second); expect(history.redo()?.name).toBe('다음 작업');
  });
  it('discards redo after a new edit and prevents outside mutations', () => {
    const history = new History({ value: 0 }); const external = { value: 1 }; history.push(external); external.value = 99;
    expect(history.current.value).toBe(1); history.undo(); history.push({ value: 2 }); expect(history.canRedo).toBe(false);
    const current = history.current; current.value = 500; expect(history.current.value).toBe(2);
  });
  it('groups a pointer drag into one undo step', () => {
    const history = new History({ x: 0 }); history.beginGroup(); for (let x = 1; x <= 50; x++) history.push({ x }); history.endGroup();
    expect(history.undoCount).toBe(1); expect(history.undo()).toEqual({ x: 0 }); expect(history.redo()).toEqual({ x: 50 });
  });
  it('caps retained undo snapshots at 100 and skips no-op edits', () => {
    const history = new History({ value: 0 }); history.push({ value: 0 }); expect(history.undoCount).toBe(0);
    for (let value = 1; value <= 150; value++) history.push({ value });
    expect(history.undoCount).toBe(100); for (let i = 0; i < 100; i++) history.undo(); expect(history.current.value).toBe(50); expect(history.canUndo).toBe(false);
  });
  it('resets history when opening another document', () => { const history = new History(0); history.push(1); history.reset(9); expect(history.current).toBe(9); expect(history.canUndo).toBe(false); });
});
