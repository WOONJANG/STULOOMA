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
});
