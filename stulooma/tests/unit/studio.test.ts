import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudio } from '../../src/state/studio';
import { createProject, loadProject, saveProject } from '../../src/core/project';
import { layer, project } from '../security/fixtures';

beforeEach(() => { vi.useRealTimers(); useStudio.getState().newProject(); });

describe('actual editor command store', () => {
  it('preserves artwork, original assets, materials and Korean names through commands and round-trip', async () => {
    const original = project(), s = useStudio.getState();
    s.execute({ id: 'project.rename', name: '서울 유니폼 김수현' });
    s.execute({ id: 'artwork.add', layer: layer(), asset: original.assets.logo });
    s.selectRegion('BACK'); s.execute({ id: 'artwork.add', layer: layer('BACK', 'back') });
    s.execute({ id: 'material.update', regionId: 'BACK', patch: { color: '#123456', roughness: 0.4 } });
    const restored = await loadProject(await saveProject(useStudio.getState().project));
    expect(restored).toEqual(useStudio.getState().project); expect(restored.layers.map(item => item.regionId)).toEqual(['FRONT', 'BACK']);
  });
  it('groups drag updates and restores deleted layers with multiple undo and redo', () => {
    const s = useStudio.getState(); s.replace(project()); s.beginGroup();
    for (let i = 0; i < 20; i++) s.execute({ id: 'artwork.update', layerId: 'front-logo', patch: { x: i / 20 } });
    s.endGroup(); expect(useStudio.getState().past).toHaveLength(1);
    s.execute({ id: 'artwork.delete', layerId: 'front-logo' }); s.undo(); expect(useStudio.getState().project.layers).toHaveLength(2);
    s.undo(); expect(useStudio.getState().project.layers[0]!.x).toBe(0.3);
    s.redo(); expect(useStudio.getState().project.layers[0]!.x).toBe(0.95);
    s.execute({ id: 'project.rename', name: '새 작업' }); expect(useStudio.getState().future).toHaveLength(0);
  });
  it('finishes an active drag before undo so only that drag is undone', () => {
    const s = useStudio.getState(); s.replace(project()); s.execute({ id: 'project.rename', name: '이미 바꾼 이름' });
    s.beginGroup(); s.execute({ id: 'artwork.update', layerId: 'front-logo', patch: { x: 0.8 } }); s.undo();
    expect(useStudio.getState().project.name).toBe('이미 바꾼 이름'); expect(useStudio.getState().project.layers[0]!.x).toBe(0.3);
    s.redo(); expect(useStudio.getState().project.layers[0]!.x).toBe(0.8);
  });
  it('does not mark newer work saved when an older asynchronous save completes', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    const s = useStudio.getState(); s.newProject(); s.execute({ id: 'project.rename', name: '저장 중인 이름' });
    const saving = useStudio.getState().project;
    s.execute({ id: 'project.rename', name: '저장 후 새 편집' }); s.markSaved(saving.id, saving.updatedAt);
    expect(useStudio.getState().dirty).toBe(true);
    s.undo(); expect(useStudio.getState().dirty).toBe(false); s.redo(); expect(useStudio.getState().dirty).toBe(true);
    const current = useStudio.getState().project; s.markSaved(current.id, current.updatedAt); expect(useStudio.getState().dirty).toBe(false);
  });
  it('copies imported state and command assets to preserve command history ownership', () => {
    const input = project(), s = useStudio.getState(); s.replace(input); input.name = '외부에서 변경'; expect(useStudio.getState().project.name).not.toBe(input.name);
    s.newProject(); const asset = project().assets.logo!; s.execute({ id: 'artwork.add', layer: layer(), asset }); asset.name = '외부에서 변경.png'; expect(useStudio.getState().project.assets.logo!.name).not.toBe(asset.name);
  });
  it('ignores stale region IDs from an obsolete component after project replacement', () => {
    const s = useStudio.getState(); expect(() => s.execute({ id: 'material.update', regionId: 'OLD_REGION', patch: { color: '#112233' } })).not.toThrow();
    expect(useStudio.getState().dirty).toBe(false);
  });
  it('clears undo and selection when replacing or creating a project', () => {
    const s = useStudio.getState(); s.replace(project()); s.selectLayer('front-logo'); s.execute({ id: 'artwork.delete', layerId: 'back-logo' });
    s.replace(createProject('basketball')); expect(useStudio.getState().past).toHaveLength(0); expect(useStudio.getState().selectedLayer).toBeNull();
    s.newProject(); expect(useStudio.getState().project.garment.kind).toBe('tshirt');
  });
  it('does not dirty or add history for repeated values, invalid selections or no-op groups', () => {
    const s = useStudio.getState(); s.replace(project());
    const initial = useStudio.getState().project;
    s.execute({ id: 'project.rename', name: initial.name });
    s.execute({ id: 'artwork.update', layerId: 'front-logo', patch: { x: .3, width: Number.NaN } });
    s.execute({ id: 'artwork.delete', layerId: 'missing' });
    s.selectLayer('missing');
    expect(useStudio.getState().selectedLayer).toBeNull();
    expect(useStudio.getState().project.updatedAt).toBe(initial.updatedAt);
    expect(useStudio.getState().dirty).toBe(false); expect(useStudio.getState().past).toHaveLength(0);
    s.beginGroup(); s.execute({ id: 'artwork.nudge', layerId: 'front-logo', dx: .1, dy: 0 });
    s.execute({ id: 'artwork.update', layerId: 'front-logo', patch: { x: .3 } }); s.endGroup();
    expect(useStudio.getState().past).toHaveLength(0); expect(useStudio.getState().dirty).toBe(false);
  });
  it('protects locked content but allows naming, visibility and a separate unlock', () => {
    const s = useStudio.getState(); const initial = project(); initial.layers[0]!.locked = true; s.replace(initial);
    s.selectLayer('front-logo');
    s.execute({ id: 'artwork.update', layerId: 'front-logo', patch: { x: .8, rotation: 90, opacity: .1 } });
    s.execute({ id: 'artwork.nudge', layerId: 'front-logo', dx: .2, dy: .2 });
    s.execute({ id: 'artwork.align', layerId: 'front-logo', alignment: 'center' });
    s.execute({ id: 'artwork.delete', layerId: 'front-logo' });
    expect(useStudio.getState().project.layers).toEqual(initial.layers);
    expect(useStudio.getState().past).toHaveLength(0);
    s.execute({ id: 'artwork.update', layerId: 'front-logo', patch: { name: '고정된 한글 로고', visible: false, locked: false, x: .8 } });
    expect(useStudio.getState().project.layers[0]).toMatchObject({ name: '고정된 한글 로고', visible: false, locked: false, x: .3 });
    s.execute({ id: 'artwork.update', layerId: 'front-logo', patch: { x: .8 } });
    expect(useStudio.getState().project.layers[0]!.x).toBe(.8);
  });
  it('aligns rotated artwork bounds and nudges with undo while preserving selection', () => {
    const s = useStudio.getState(); const initial = project(); initial.layers[0]!.rotation = 90; s.replace(initial); s.selectLayer('front-logo');
    s.execute({ id: 'artwork.align', layerId: 'front-logo', alignment: 'left' });
    expect(useStudio.getState().project.layers[0]!.x).toBeCloseTo(.1);
    s.execute({ id: 'artwork.align', layerId: 'front-logo', alignment: 'bottom' });
    expect(useStudio.getState().project.layers[0]!.y).toBeCloseTo(.875);
    s.execute({ id: 'artwork.align', layerId: 'front-logo', alignment: 'center' });
    s.execute({ id: 'artwork.align', layerId: 'front-logo', alignment: 'middle' });
    s.beginGroup();
    for (let i = 0; i < 10; i++) s.execute({ id: 'artwork.nudge', layerId: 'front-logo', dx: .001, dy: -.01 });
    s.endGroup();
    expect(useStudio.getState().project.layers[0]!.x).toBeCloseTo(.51);
    expect(useStudio.getState().project.layers[0]!.y).toBeCloseTo(.4);
    s.undo(); expect(useStudio.getState().project.layers[0]).toMatchObject({ x: .5, y: .5 });
    expect(useStudio.getState().selectedLayer).toBe('front-logo');
    s.redo(); expect(useStudio.getState().project.layers[0]!.x).toBeCloseTo(.51);
    expect(useStudio.getState().selectedLayer).toBe('front-logo');
  });
  it('orders only sibling layers in the same region and leaves other region order intact', () => {
    const s = useStudio.getState(); const initial = project(); initial.layers.push({ ...layer(), id: 'front-second' }); s.replace(initial);
    s.execute({ id: 'layer.reorder', layerId: 'front-logo', direction: 1 });
    expect(useStudio.getState().project.layers.map(item => item.id)).toEqual(['front-second', 'back-logo', 'front-logo']);
    s.execute({ id: 'layer.reorder', layerId: 'front-logo', direction: 1 });
    expect(useStudio.getState().past).toHaveLength(1);
    s.undo(); expect(useStudio.getState().project.layers).toEqual(initial.layers);
    s.selectLayer('front-logo'); s.execute({ id: 'artwork.delete', layerId: 'back-logo' });
    expect(useStudio.getState().selectedLayer).toBe('front-logo');
  });
  it('copies immutable artwork across regions and new projects with original asset bytes', async () => {
    const s = useStudio.getState(); s.replace(project()); s.selectLayer('front-logo'); expect(s.copyLayer()).toBe(true);
    s.execute({ id: 'artwork.update', layerId: 'front-logo', patch: { name: '복사 후 변경', x: .8 } });
    s.selectRegion('BACK'); expect(s.pasteLayer()).toBe(true);
    const first = useStudio.getState().project.layers.at(-1)!;
    expect(first).toMatchObject({ name: '가슴 로고 붙여넣기', regionId: 'BACK', x: .325, y: .225, assetId: 'logo', locked: false });
    expect(first.id).not.toBe('front-logo'); expect(Object.keys(useStudio.getState().project.assets)).toHaveLength(1);
    s.undo(); expect(useStudio.getState().project.layers).toHaveLength(2);
    s.newProject('basketball'); s.selectRegion('BACK'); expect(useStudio.getState().canPaste).toBe(true);
    expect(s.pasteLayer()).toBe(true); const pasted = useStudio.getState().project.layers[0]!;
    expect(pasted.id).not.toBe(first.id); expect(pasted.assetId).not.toBe('logo');
    expect(pasted).toMatchObject({ regionId: 'BACK', x: .35, y: .25 });
    expect(useStudio.getState().project.assets[pasted.assetId!]!.data).toBe(project().assets.logo!.data);
    expect(await loadProject(await saveProject(useStudio.getState().project))).toEqual(useStudio.getState().project);
    s.undo(); expect(Object.keys(useStudio.getState().project.assets)).toHaveLength(0); expect(useStudio.getState().dirty).toBe(false);
  });
  it('preserves save cleanliness when undo or redo returns to the saved content', () => {
    const s = useStudio.getState(); s.replace(project()); s.selectLayer('front-logo');
    s.execute({ id: 'artwork.nudge', layerId: 'front-logo', dx: .1, dy: 0 });
    const saved = useStudio.getState().project; s.markSaved(saved.id, saved.updatedAt);
    s.execute({ id: 'project.rename', name: '임시 이름' }); expect(useStudio.getState().dirty).toBe(true);
    s.undo(); expect(useStudio.getState().dirty).toBe(false);
    s.undo(); expect(useStudio.getState().dirty).toBe(true);
    s.redo(); expect(useStudio.getState().dirty).toBe(false);
    s.selectRegion('BACK'); expect(useStudio.getState().dirty).toBe(false);
  });
  it('clamps finite numeric input and rejects NaN, invalid colors and immutable layer identity', async () => {
    const s = useStudio.getState(); s.replace(project());
    s.execute({ id: 'artwork.update', layerId: 'front-logo', patch: { id: 'changed', type: 'text', x: Number.NaN, y: Infinity, width: -4, height: 30, opacity: 20 } });
    expect(useStudio.getState().project.layers[0]).toMatchObject({ id: 'front-logo', type: 'image', x: .3, y: .2, width: .00001, height: 20, opacity: 1 });
    s.execute({ id: 'material.update', regionId: 'FRONT', patch: { color: 'invalid', roughness: -2, metalness: Infinity } });
    expect(useStudio.getState().project.regions.FRONT).toEqual({ color: '#221144', roughness: 0, metalness: 0 });
    expect(await loadProject(await saveProject(useStudio.getState().project))).toEqual(useStudio.getState().project);
  });
});
