import { beforeEach, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import type { VectorDocument, VectorObject } from '../../src/types/vector';
import { bytesToDataUrl, createProject, dataUrlToBytes, loadProject, saveProject, validateProject } from '../../src/core/project';
import { createVectorDocument, createVectorObject, selectedVectorRoots, vectorWorldMatrix } from '../../src/core/vector/document';
import { validateVectorDocument, VectorValidationError } from '../../src/core/vector/validation';
import { useStudio } from '../../src/state/studio';
import { glb, png, project } from '../security/fixtures';

function vectorFixture(): VectorDocument {
  const document = createVectorDocument('서울 유니폼 벡터'); const artboardId = document.artboards[0]!.id;
  const group = createVectorObject('group', artboardId, { id: 'group', transform: [1, 0, 0, 1, 10, 20] });
  const path = createVectorObject('path', artboardId, {
    id: 'logo-path', parentId: group.id, transform: [2, 0, 0, 2, 30, 40],
    geometry: { fillRule: 'evenodd', contours: [{ closed: true, anchors: [{ id: 'a', x: 0, y: 0, kind: 'corner', out: { x: 20, y: 0 } }, { id: 'b', x: 100, y: 100, kind: 'smooth', in: { x: 80, y: 100 } }, { id: 'c', x: 0, y: 100, kind: 'symmetric' }] }] },
    fill: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, units: 'objectBoundingBox', transform: [1, 0, 0, 1, 0, 0], stops: [{ offset: 0, color: '#112233', opacity: .5 }, { offset: 1, color: '#aabbcc', opacity: 1 }] },
    stroke: { paint: { type: 'solid', color: '#ffffff', opacity: 1 }, width: 3, lineCap: 'round', lineJoin: 'bevel', miterLimit: 4, dash: [3, 2], dashOffset: 1 },
  });
  const text = createVectorObject('text', artboardId, { id: 'player-name', text: { content: '김수현 23', fontFamily: 'Noto Sans KR Variable', fontSize: 48, fontWeight: 700, letterSpacing: 1, lineHeight: 1.2, alignment: 'middle' } });
  const image = createVectorObject('image', artboardId, { id: 'photo', image: { assetId: 'logo', width: 120, height: 80 } });
  document.objects = [group, path, text, image]; document.assets = ['logo'];
  document.metadata = { original: '클린룸 테스트', print: { colorMode: 'sRGB' } };
  return document;
}
const setDocument = (document: VectorDocument) => useStudio.getState().execute({ id: 'vector.document.set', document });
const bindDocument = (document: VectorDocument, regionId = 'FRONT') => useStudio.getState().execute({ id: 'vector.garment.bind', documentId: document.id, artboardId: document.artboards[0]!.id, regionId });

beforeEach(() => useStudio.getState().newProject());

describe('editable vectors inside the existing project archive', () => {
  it('keeps legacy projects in version 1 and preserves original PNG/GLB bytes when vectors are added', async () => {
    const original = project(); const model = glb();
    original.garment = { kind: 'custom', name: '원본 모델', assetId: 'model' };
    original.assets.model = { id: 'model', name: '원본.glb', mime: 'model/gltf-binary', data: bytesToDataUrl(model, 'model/gltf-binary') };
    const legacy = await loadProject(await saveProject(original));
    expect(legacy.version).toBe(1); expect(legacy).not.toHaveProperty('vectorDocuments');
    const store = useStudio.getState(); store.replace(legacy); const document = vectorFixture(); setDocument(document); bindDocument(document);
    const current = useStudio.getState().project; const bytes = await saveProject(current); const restored = await loadProject(bytes);
    expect(restored).toEqual(current); expect(restored.version).toBe(2);
    expect(restored.vectorDocuments?.[document.id]).toEqual(document);
    expect(restored.layers.slice(0, legacy.layers.length)).toEqual(legacy.layers);
    expect(dataUrlToBytes(restored.assets.logo!.data, 'image/png')).toEqual(png());
    expect(dataUrlToBytes(restored.assets.model!.data, 'model/gltf-binary')).toEqual(model);
    const entries = unzipSync(bytes); expect(entries['assets/logo.png']).toEqual(png()); expect(entries['assets/model.glb']).toEqual(model);
    expect(await loadProject(await saveProject(restored))).toEqual(restored);
  });

  it('retains groups, clipping, opacity masks, multiple artboards and editable gradients', async () => {
    const p = project(); p.version = 2; const document = vectorFixture();
    const artboard = { ...document.artboards[0]!, id: 'second-artboard', name: '뒷면', x: 1200 };
    document.artboards.push(artboard);
    const clip = createVectorObject('group', document.artboards[0]!.id, { id: 'clip' });
    const clipPath = createVectorObject('path', document.artboards[0]!.id, { id: 'clip-shape', parentId: clip.id, geometry: structuredClone(document.objects[1]!.geometry) });
    const mask = createVectorObject('path', document.artboards[0]!.id, { id: 'mask', geometry: structuredClone(document.objects[1]!.geometry) });
    document.objects[3]!.clipPathId = clip.id; document.objects[2]!.maskId = mask.id;
    document.objects.push(clip, clipPath, mask, createVectorObject('text', artboard.id));
    p.vectorDocuments = { [document.id]: document };
    expect(await loadProject(await saveProject(p))).toEqual(p);
  });

  it('requires version 2 for vector fields, validates binding references and rejects future required versions', () => {
    const p = createProject(); const document = createVectorDocument();
    expect(() => validateProject({ ...p, vectorDocuments: {} })).toThrow(/버전 2/);
    expect(() => validateProject({ ...p, version: 3 })).toThrow(/버전/);
    expect(() => validateProject({ ...p, version: 2, vectorDocuments: { wrong: document } })).toThrow(/키와 ID/);
    const store = useStudio.getState(); setDocument(document); bindDocument(document);
    const bad = structuredClone(useStudio.getState().project); bad.layers[0]!.vectorArtboardId = 'missing';
    expect(() => validateProject(bad)).toThrow(/아트보드/);
    store.newProject(); expect(useStudio.getState().project.version).toBe(1);
  });
});

describe('one command history for vectors and garment bindings', () => {
  it('groups path drags, restores vector content and keeps an existing garment placement stable', () => {
    const store = useStudio.getState(); store.replace(project()); const document = vectorFixture(); setDocument(document); bindDocument(document);
    const binding = useStudio.getState().project.layers.at(-1)!;
    store.execute({ id: 'artwork.update', layerId: binding.id, patch: { x: .3, y: .7, width: .25, height: .35, rotation: 32 } });
    const original = structuredClone(useStudio.getState().project); const past = useStudio.getState().past.length;
    store.beginGroup();
    for (let step = 1; step <= 20; step++) { const edited = structuredClone(document); edited.objects[1]!.geometry!.contours[0]!.anchors[0]!.x = step; setDocument(edited); }
    store.endGroup();
    expect(useStudio.getState().past).toHaveLength(past + 1);
    expect(useStudio.getState().project.layers.at(-1)).toEqual(original.layers.at(-1));
    store.undo(); expect(useStudio.getState().project).toEqual(original);
    store.redo(); expect(useStudio.getState().project.vectorDocuments?.[document.id]?.objects[1]!.geometry!.contours[0]!.anchors[0]!.x).toBe(20);
    store.execute({ id: 'project.rename', name: '새 작업' }); expect(useStudio.getState().future).toHaveLength(0);
  });

  it('makes repeated binding idempotent and protects locked bindings during placement changes and unbinding', () => {
    const document = createVectorDocument(); const store = useStudio.getState(); setDocument(document); bindDocument(document);
    const layer = useStudio.getState().project.layers[0]!; const past = useStudio.getState().past.length;
    bindDocument(document); expect(useStudio.getState().project.layers).toHaveLength(1); expect(useStudio.getState().past).toHaveLength(past);
    store.execute({ id: 'artwork.update', layerId: layer.id, patch: { locked: true } });
    store.execute({ id: 'vector.garment.bind', documentId: document.id, artboardId: document.artboards[0]!.id, regionId: 'BACK', layerId: layer.id });
    store.execute({ id: 'vector.garment.unbind', layerId: layer.id });
    expect(useStudio.getState().project.layers[0]).toMatchObject({ regionId: 'FRONT', locked: true });
    store.execute({ id: 'artwork.update', layerId: layer.id, patch: { locked: false } });
    store.execute({ id: 'vector.garment.unbind', layerId: layer.id });
    expect(useStudio.getState().project.layers).toHaveLength(0); expect(useStudio.getState().project.vectorDocuments?.[document.id]).toEqual(document);
    store.undo(); expect(useStudio.getState().project.layers[0]!.id).toBe(layer.id);
  });

  it('removes dangling placements atomically when deleting artboards or documents, with undo', () => {
    const document = createVectorDocument(); document.artboards.push({ ...document.artboards[0]!, id: 'second-board' });
    const store = useStudio.getState(); setDocument(document); bindDocument(document);
    const before = structuredClone(useStudio.getState().project);
    const edited = structuredClone(document); edited.artboards.shift(); setDocument(edited);
    expect(useStudio.getState().project.layers).toHaveLength(0); expect(useStudio.getState().selectedLayer).toBeNull();
    store.undo(); expect(useStudio.getState().project).toEqual(before);
    store.execute({ id: 'vector.document.remove', documentId: document.id });
    expect(useStudio.getState().project.vectorDocuments).toEqual({}); expect(useStudio.getState().project.layers).toHaveLength(0);
    store.undo(); expect(useStudio.getState().project).toEqual(before);
  });

  it('copies editable vector artwork and PNG originals across projects in one undo unit without ID collisions', async () => {
    const store = useStudio.getState(); store.replace(project()); const document = vectorFixture(); setDocument(document); bindDocument(document);
    expect(store.copyLayer()).toBe(true);
    const originalAsset = project().assets.logo!;
    const next = createProject('basketball'); next.assets.logo = { id: 'logo', name: '충돌 모델.glb', mime: 'model/gltf-binary', data: bytesToDataUrl(glb(), 'model/gltf-binary') };
    store.replace(next); store.selectRegion('BACK'); const beforePaste = structuredClone(useStudio.getState().project); expect(store.pasteLayer()).toBe(true);
    const pasted = useStudio.getState().project; const layer = pasted.layers[0]!; const vector = pasted.vectorDocuments?.[layer.vectorDocumentId!]!;
    expect(layer).toMatchObject({ type: 'vector', regionId: 'BACK' }); expect(vector.id).not.toBe(document.id);
    expect(vector.objects[1]!.geometry).toEqual(document.objects[1]!.geometry); expect(vector.objects[2]!.text?.content).toBe('김수현 23');
    expect(vector.assets[0]).not.toBe('logo'); expect(pasted.assets[vector.assets[0]!]!.data).toBe(originalAsset.data); expect(pasted.assets.logo!.name).toBe('충돌 모델.glb');
    expect(useStudio.getState().past).toHaveLength(1); expect(await loadProject(await saveProject(pasted))).toEqual(pasted);
    store.undo(); expect(useStudio.getState().project).toEqual(beforePaste); expect(useStudio.getState().dirty).toBe(false);
    store.redo(); expect(useStudio.getState().project).toEqual(pasted);
  });

  it('owns command inputs and rejects malformed vector edits without changing assets or history', () => {
    const document = createVectorDocument(); const store = useStudio.getState(); setDocument(document);
    document.name = '외부 변경'; expect(useStudio.getState().project.vectorDocuments?.[document.id]?.name).not.toBe(document.name);
    const before = structuredClone(useStudio.getState().project); const count = useStudio.getState().past.length;
    const invalid = structuredClone(document); invalid.objects.push(createVectorObject('image', invalid.artboards[0]!.id, { image: { assetId: 'missing', width: 100, height: 100 } }));
    expect(() => store.execute({ id: 'vector.document.set', document: invalid, assets: [project().assets.logo!] })).toThrow(VectorValidationError);
    expect(useStudio.getState().project).toEqual(before); expect(useStudio.getState().past).toHaveLength(count);
  });

  it('rejects vector edits that cannot fit the unchanged UTF-8 archive manifest limit', async () => {
    const first = createVectorDocument(); first.metadata = { notes: Array.from({ length: 8 }, () => '한'.repeat(50_000)) }; setDocument(first);
    const accepted = structuredClone(useStudio.getState().project); expect(await loadProject(await saveProject(accepted))).toEqual(accepted);
    const second = structuredClone(first); second.id = 'oversize-document';
    expect(() => setDocument(second)).toThrow(/2 MiB/); expect(useStudio.getState().project).toEqual(accepted);
  });
});

describe('untrusted editable vector validation', () => {
  it('rejects duplicate IDs, dangling PNG references, unknown data, NaN and invalid gradients', () => {
    const base = vectorFixture(); const assets = project().assets;
    const changes: ((document: VectorDocument) => void)[] = [
      document => { document.objects[1]!.id = document.objects[0]!.id; },
      document => { document.objects[1]!.geometry!.contours[0]!.anchors[1]!.id = 'a'; },
      document => { document.objects[3]!.image!.assetId = 'missing'; },
      document => { document.objects[1]!.transform[0] = NaN; },
      document => { document.objects[1]!.geometry!.contours[0]!.anchors[0]!.x = Infinity; },
      document => { (document.objects[1]!.fill as { stops: { offset: number }[] }).stops[0]!.offset = 2; },
      document => { (document.objects[1]!.fill as unknown as { transform: number[] }).transform[0] = 1e8; },
      document => { (document.objects[0] as unknown as Record<string, unknown>).script = 'alert(1)'; },
    ];
    for (const change of changes) { const document = structuredClone(base); change(document); expect(() => validateVectorDocument(document, assets)).toThrow(VectorValidationError); }
    expect(() => validateVectorDocument(base, { logo: { ...assets.logo!, mime: 'model/gltf-binary' } })).toThrow(/PNG/);
  });

  it('rejects parent, clipping and mask cycles, cross-artboard references and excessive transform products', () => {
    const base = createVectorDocument(); const artboardId = base.artboards[0]!.id;
    base.objects = [createVectorObject('group', artboardId, { id: 'a' }), createVectorObject('group', artboardId, { id: 'b', parentId: 'a' })];
    for (const mutate of [
      (objects: VectorObject[]) => { objects[0]!.parentId = 'b'; },
      (objects: VectorObject[]) => { objects[1]!.clipPathId = 'a'; },
      (objects: VectorObject[]) => { objects[0]!.maskId = 'b'; objects[1]!.maskId = 'a'; },
    ]) { const document = structuredClone(base); mutate(document.objects); expect(() => validateVectorDocument(document)).toThrow(/순환/); }
    const document = structuredClone(base); document.artboards.push({ ...document.artboards[0]!, id: 'other-board' }); document.objects[1]!.artboardId = 'other-board';
    expect(() => validateVectorDocument(document)).toThrow(/그룹 참조/);
    const huge = structuredClone(base); huge.objects[0]!.transform = [1e6, 0, 0, 1e6, 0, 0]; huge.objects[1]!.transform = [1e6, 0, 0, 1e6, 0, 0];
    huge.objects.push(createVectorObject('group', artboardId, { parentId: 'b', transform: [1e6, 0, 0, 1e6, 0, 0] }));
    expect(() => validateVectorDocument(huge)).toThrow(/월드 변환/);
  });

  it('bounds hierarchy depth independent of object order and rejects cyclic/non-JSON metadata', () => {
    const document = createVectorDocument(); const artboardId = document.artboards[0]!.id;
    for (let index = 0; index < 65; index++) document.objects.push(createVectorObject('group', artboardId, { id: `node-${index}`, parentId: index === 0 ? null : `node-${index - 1}` }));
    document.objects.reverse(); expect(() => validateVectorDocument(document)).toThrow(/깊/);
    const cycle = createVectorDocument(); const metadata: Record<string, unknown> = {}; metadata.self = metadata; cycle.metadata = metadata;
    expect(() => validateVectorDocument(cycle)).toThrow(/복잡도/);
    const nonJson = createVectorDocument(); nonJson.metadata = { date: new Date() }; expect(() => validateVectorDocument(nonJson)).toThrow(/JSON/);
  });

  it('computes document transforms and selection roots without modifying object coordinates', () => {
    const document = vectorFixture(); const before = structuredClone(document);
    expect(vectorWorldMatrix(document, 'logo-path')).toEqual([2, 0, 0, 2, 40, 60]);
    expect(selectedVectorRoots(document, ['group', 'logo-path', 'player-name']).map(object => object.id)).toEqual(['group', 'player-name']);
    expect(document).toEqual(before);
  });
});
