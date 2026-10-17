import { create } from 'zustand';
import type { ArtworkLayer, AssetRecord, GarmentKind, ProjectDocument, RegionDesign } from '../types/project';
import { createProject } from '../core/project';

export type EditCommand =
  | { id: 'project.rename'; name: string }
  | { id: 'artwork.add'; layer: ArtworkLayer; asset?: AssetRecord }
  | { id: 'artwork.update'; layerId: string; patch: Partial<ArtworkLayer> }
  | { id: 'artwork.delete' | 'artwork.duplicate'; layerId: string }
  | { id: 'layer.reorder'; layerId: string; direction: -1 | 1 }
  | { id: 'material.update'; regionId: string; patch: Partial<RegionDesign> }
  | { id: 'settings.update'; patch: Partial<ProjectDocument['settings']> };
export interface StudioState {
  project: ProjectDocument; past: ProjectDocument[]; future: ProjectDocument[];
  selectedLayer: string | null; dirty: boolean; lastCommand: string;
  group: ProjectDocument | null;
  execute: (command: EditCommand) => void;
  beginGroup: () => void; endGroup: () => void;
  undo: () => void; redo: () => void;
  replace: (project: ProjectDocument, dirty?: boolean) => void;
  newProject: (kind?: GarmentKind) => void;
  selectRegion: (id: string) => void; selectLayer: (id: string | null) => void;
  setCamera: (camera: ProjectDocument['camera']) => void;
  markSaved: (projectId: string, updatedAt: string) => void;
}
const copy = <T,>(value: T): T => structuredClone(value);
// Async saves identify their document revision by updatedAt. Ensure a second
// edit in the same millisecond cannot accidentally be marked saved with it.
const nextTimestamp = (previous: string) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
export const useStudio = create<StudioState>((set, get) => ({
  project: createProject(), past: [], future: [], selectedLayer: null, dirty: false,
  lastCommand: '프로젝트 시작', group: null,
  execute(command) {
    const state = get(); const p = copy(state.project); let selected = state.selectedLayer;
    switch (command.id) {
      case 'project.rename': p.name = command.name.slice(0, 120); break;
      case 'artwork.add':
        if (command.asset) p.assets[command.asset.id] = copy(command.asset);
        p.layers.push(copy(command.layer)); selected = command.layer.id; break;
      case 'artwork.update': {
        const layer = p.layers.find(l => l.id === command.layerId);
        if (!layer) return;
        Object.assign(layer, command.patch, { id: layer.id }); break;
      }
      case 'artwork.delete': p.layers = p.layers.filter(l => l.id !== command.layerId); selected = null; break;
      case 'artwork.duplicate': {
        const layer = p.layers.find(l => l.id === command.layerId); if (!layer) return;
        const clone = { ...layer, id: crypto.randomUUID(), name: `${layer.name} 사본`, x: layer.x + .035, y: layer.y + .035 };
        p.layers.push(clone); selected = clone.id; break;
      }
      case 'layer.reorder': {
        const i = p.layers.findIndex(l => l.id === command.layerId); const j = i + command.direction;
        if (i < 0 || j < 0 || j >= p.layers.length) return;
        [p.layers[i], p.layers[j]] = [p.layers[j], p.layers[i]]; break;
      }
      case 'material.update': if (!p.regions[command.regionId]) return; Object.assign(p.regions[command.regionId], command.patch); break;
      case 'settings.update': Object.assign(p.settings, command.patch); break;
    }
    p.updatedAt = nextTimestamp(state.project.updatedAt);
    set({ project: p, past: state.group ? state.past : [...state.past, state.project].slice(-100), future: [], dirty: true, selectedLayer: selected, lastCommand: command.id });
  },
  beginGroup() { if (!get().group) set({ group: copy(get().project) }); },
  endGroup() {
    const s = get(); if (!s.group) return;
    const changed = JSON.stringify(s.group) !== JSON.stringify(s.project);
    set({ past: changed ? [...s.past, s.group].slice(-100) : s.past, group: null });
  },
  undo() { get().endGroup(); const s = get(); if (!s.past.length) return; set({ project: s.past.at(-1)!, past: s.past.slice(0, -1), future: [s.project, ...s.future], selectedLayer: null, dirty: true, lastCommand: '실행 취소', group: null }); },
  redo() { get().endGroup(); const s = get(); if (!s.future.length) return; set({ project: s.future[0], past: [...s.past, s.project], future: s.future.slice(1), selectedLayer: null, dirty: true, lastCommand: '다시 실행', group: null }); },
  replace(project, dirty = false) { set({ project: copy(project), past: [], future: [], group: null, selectedLayer: null, dirty, lastCommand: '프로젝트 열기' }); },
  newProject(kind = 'tshirt') { get().replace(createProject(kind)); },
  selectRegion(id) { const s = get(); if (!s.project.regions[id]) return; set({ project: { ...s.project, activeRegion: id }, selectedLayer: null }); },
  selectLayer(id) { const layer = get().project.layers.find(l => l.id === id); set({ selectedLayer: id, ...(layer ? { project: { ...get().project, activeRegion: layer.regionId } } : {}) }); },
  setCamera(camera) { const s = get(); if (JSON.stringify(s.project.camera) !== JSON.stringify(camera)) set({ project: { ...s.project, camera: copy(camera), updatedAt: nextTimestamp(s.project.updatedAt) }, dirty: true }); },
  markSaved(projectId, updatedAt) { const p = get().project; if (p.id === projectId && p.updatedAt === updatedAt) set({ dirty: false }); },
}));
