import { create } from 'zustand';
import type { ArtworkLayer, AssetRecord, GarmentKind, ProjectDocument, RegionDesign } from '../types/project';
import type { VectorDocument } from '../types/vector';
import { createProject, PROJECT_LIMITS, dataUrlToBytes, validateAssetBytes } from '../core/project';
import { validateVectorDocument, VECTOR_LIMITS, VectorValidationError } from '../core/vector/validation';

export type ArtworkAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type EditCommand =
  | { id: 'project.rename'; name: string }
  | { id: 'artwork.add'; layer: ArtworkLayer; asset?: AssetRecord }
  | { id: 'artwork.update'; layerId: string; patch: Partial<ArtworkLayer> }
  | { id: 'artwork.delete' | 'artwork.duplicate'; layerId: string }
  | { id: 'artwork.align'; layerId: string; alignment: ArtworkAlignment }
  | { id: 'artwork.nudge'; layerId: string; dx: number; dy: number }
  | { id: 'layer.reorder'; layerId: string; direction: -1 | 1 }
  | { id: 'material.update'; regionId: string; patch: Partial<RegionDesign> }
  | { id: 'settings.update'; patch: Partial<ProjectDocument['settings']> }
  | { id: 'vector.document.set'; document: VectorDocument; assets?: AssetRecord[] }
  | { id: 'vector.document.remove'; documentId: string }
  | { id: 'vector.garment.bind'; documentId: string; artboardId: string; regionId: string; layerId?: string }
  | { id: 'vector.garment.unbind'; layerId: string };

const commandLabels: Record<EditCommand['id'], string> = {
  'project.rename': '프로젝트 이름 변경', 'artwork.add': '레이어 추가',
  'artwork.update': '레이어 수정', 'artwork.delete': '레이어 삭제',
  'artwork.duplicate': '레이어 복제', 'artwork.align': '캔버스에 정렬',
  'artwork.nudge': '레이어 이동', 'layer.reorder': '레이어 순서 변경',
  'material.update': '원단 재질 변경', 'settings.update': '작업 설정 변경',
  'vector.document.set': '벡터 디자인 수정', 'vector.document.remove': '벡터 문서 삭제',
  'vector.garment.bind': '벡터 디자인 의류 적용', 'vector.garment.unbind': '벡터 디자인 연결 해제',
};
export const commandLabel = (command: EditCommand): string => commandLabels[command.id];

export interface StudioState {
  project: ProjectDocument; past: ProjectDocument[]; future: ProjectDocument[];
  selectedLayer: string | null; dirty: boolean; lastCommand: string;
  group: ProjectDocument | null; canPaste: boolean;
  execute: (command: EditCommand) => void;
  beginGroup: () => void; endGroup: () => void;
  undo: () => void; redo: () => void;
  replace: (project: ProjectDocument, dirty?: boolean) => void;
  newProject: (kind?: GarmentKind) => void;
  selectRegion: (id: string) => void; selectLayer: (id: string | null) => void;
  copyLayer: () => boolean; pasteLayer: () => boolean;
  setCamera: (camera: ProjectDocument['camera']) => void;
  markSaved: (projectId: string, updatedAt: string) => void;
}
const copy = <T,>(value: T): T => structuredClone(value);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const cleanText = (value: string, maximum: number) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, maximum);
// Region selection is navigation. Saving, undoing and returning to an earlier
// document content should agree about the unsaved indicator, regardless of it.
const sameAsset = (a: AssetRecord, b: AssetRecord) => a.id === b.id && a.name === b.name && a.mime === b.mime && a.data === b.data;
const sameContent = (a: ProjectDocument, b: ProjectDocument | null): boolean => {
  if (!b) return false;
  // Original asset data can occupy tens of megabytes. Compare those immutable
  // strings directly instead of allocating JSON copies on every pointer move.
  const assetIds = Object.keys(a.assets);
  if (assetIds.length !== Object.keys(b.assets).length || assetIds.some(id => !b.assets[id] || !sameAsset(a.assets[id]!, b.assets[id]!))) return false;
  const { updatedAt: _aUpdatedAt, activeRegion: _aRegion, assets: _aAssets, ...aContent } = a;
  const { updatedAt: _bUpdatedAt, activeRegion: _bRegion, assets: _bAssets, ...bContent } = b;
  return JSON.stringify(aContent) === JSON.stringify(bContent);
};
// Async saves identify revisions by updatedAt, including edits in one millisecond.
const nextTimestamp = (previous: string) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

function updateLayer(layer: ArtworkLayer, patch: Partial<ArtworkLayer>, project: ProjectDocument): void {
  if (typeof patch.name === 'string') {
    const name = cleanText(patch.name, 160); if (name.trim()) layer.name = name;
  }
  if (typeof patch.visible === 'boolean') layer.visible = patch.visible;
  // An unlock and a transform cannot be smuggled together in one patch.
  const wasLocked = layer.locked;
  if (typeof patch.locked === 'boolean') layer.locked = patch.locked;
  if (wasLocked) return;
  const ranges = {
    x: [-10, 10], y: [-10, 10], width: [.00001, 20], height: [.00001, 20],
    rotation: [-36000, 36000], opacity: [0, 1], fontSize: [.001, 1024],
  } as const;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const value = patch[key];
    if (typeof value === 'number' && Number.isFinite(value) && (key !== 'fontSize' || layer.type === 'text')) layer[key] = clamp(value, ranges[key][0], ranges[key][1]);
  }
  if (layer.type === 'text') {
    if (typeof patch.text === 'string') layer.text = cleanText(patch.text, 2000);
    if (validColor(patch.color)) layer.color = patch.color;
  }
  if (typeof patch.regionId === 'string' && Object.hasOwn(project.regions, patch.regionId)) layer.regionId = patch.regionId;
  if (layer.type === 'image' && typeof patch.assetId === 'string' && project.assets[patch.assetId]?.mime === 'image/png') layer.assetId = patch.assetId;
}

export const useStudio = create<StudioState>((set, get) => {
  const initial = createProject();
  let savedContent: ProjectDocument | null = copy(initial);
  let clipboard: { layer: ArtworkLayer; asset?: AssetRecord; vectorDocument?: VectorDocument; vectorAssets?: AssetRecord[] } | null = null;
  let pasteCount = 0;
  const isDirty = (project: ProjectDocument) => !sameContent(project, savedContent);
  const survivingSelection = (project: ProjectDocument, selected: string | null) => project.layers.some(layer => layer.id === selected) ? selected : null;
  return {
    project: initial, past: [], future: [], selectedLayer: null, dirty: false,
    lastCommand: '프로젝트 시작', group: null, canPaste: false,
    execute(command) {
      const state = get(); const p = copy(state.project); let selected = state.selectedLayer;
      switch (command.id) {
        case 'project.rename': {
          const name = cleanText(command.name, 120); if (name.trim()) p.name = name;
          break;
        }
        case 'artwork.add': {
          if (p.layers.length >= PROJECT_LIMITS.layers || p.layers.some(layer => layer.id === command.layer.id) || !Object.hasOwn(p.regions, command.layer.regionId)) return;
          if (command.asset) {
            const existing = p.assets[command.asset.id];
            if (existing && !sameAsset(existing, command.asset)) return;
            if (!existing && Object.keys(p.assets).length >= PROJECT_LIMITS.assets) return;
            p.assets[command.asset.id] = copy(command.asset);
          }
          if (command.layer.type === 'image' && p.assets[command.layer.assetId ?? '']?.mime !== 'image/png') return;
          if (command.layer.type === 'vector' && !p.vectorDocuments?.[command.layer.vectorDocumentId ?? '']?.artboards.some(artboard => artboard.id === command.layer.vectorArtboardId)) return;
          p.layers.push(copy(command.layer)); selected = command.layer.id;
          break;
        }
        case 'artwork.update': {
          const layer = p.layers.find(item => item.id === command.layerId);
          if (!layer) return;
          updateLayer(layer, command.patch, p); break;
        }
        case 'artwork.delete': {
          const layer = p.layers.find(item => item.id === command.layerId);
          if (!layer || layer.locked) return;
          p.layers = p.layers.filter(item => item.id !== command.layerId);
          if (selected === command.layerId) selected = null;
          break;
        }
        case 'artwork.duplicate': {
          const layer = p.layers.find(item => item.id === command.layerId);
          if (!layer || p.layers.length >= PROJECT_LIMITS.layers) return;
          const clone = { ...layer, id: crypto.randomUUID(), name: `${layer.name.slice(0, 157)} 사본`, x: clamp(layer.x + .035, -10, 10), y: clamp(layer.y + .035, -10, 10), locked: false };
          p.layers.push(clone); selected = clone.id; break;
        }
        case 'artwork.align': {
          const layer = p.layers.find(item => item.id === command.layerId);
          if (!layer || layer.locked) return;
          // Align the visible, rotated bounds to the unit design canvas.
          const angle = layer.rotation * Math.PI / 180;
          const halfWidth = (Math.abs(Math.cos(angle)) * layer.width + Math.abs(Math.sin(angle)) * layer.height) / 2;
          const halfHeight = (Math.abs(Math.sin(angle)) * layer.width + Math.abs(Math.cos(angle)) * layer.height) / 2;
          if (command.alignment === 'left') layer.x = clamp(halfWidth, -10, 10);
          else if (command.alignment === 'center') layer.x = .5;
          else if (command.alignment === 'right') layer.x = clamp(1 - halfWidth, -10, 10);
          else if (command.alignment === 'top') layer.y = clamp(halfHeight, -10, 10);
          else if (command.alignment === 'middle') layer.y = .5;
          else if (command.alignment === 'bottom') layer.y = clamp(1 - halfHeight, -10, 10);
          break;
        }
        case 'artwork.nudge': {
          const layer = p.layers.find(item => item.id === command.layerId);
          if (!layer || layer.locked || !Number.isFinite(command.dx) || !Number.isFinite(command.dy)) return;
          layer.x = clamp(layer.x + command.dx, -10, 10); layer.y = clamp(layer.y + command.dy, -10, 10); break;
        }
        case 'layer.reorder': {
          const layer = p.layers.find(item => item.id === command.layerId);
          if (!layer || layer.locked) return;
          const sameRegion = p.layers.map((item, index) => item.regionId === layer.regionId ? index : -1).filter(index => index >= 0);
          const from = sameRegion.indexOf(p.layers.indexOf(layer)); const to = from + command.direction;
          if (to < 0 || to >= sameRegion.length) return;
          const a = sameRegion[from]!, b = sameRegion[to]!;
          [p.layers[a], p.layers[b]] = [p.layers[b]!, p.layers[a]!]; break;
        }
        case 'material.update': {
          const region = p.regions[command.regionId]; if (!region) return;
          if (validColor(command.patch.color)) region.color = command.patch.color;
          for (const key of ['roughness', 'metalness'] as const) {
            const value = command.patch[key]; if (typeof value === 'number' && Number.isFinite(value)) region[key] = clamp(value, 0, 1);
          }
          break;
        }
        case 'settings.update': {
          const patch = command.patch;
          if (patch.textureSize === 1024 || patch.textureSize === 2048) p.settings.textureSize = patch.textureSize;
          if (validColor(patch.background)) p.settings.background = patch.background;
          if (typeof patch.transparent === 'boolean') p.settings.transparent = patch.transparent;
          if (patch.mode === 'simple' || patch.mode === 'expert') p.settings.mode = patch.mode;
          break;
        }
        case 'vector.document.set': {
          const documents = p.vectorDocuments ?? {};
          if (!Object.hasOwn(documents, command.document.id) && Object.keys(documents).length >= VECTOR_LIMITS.documents) throw new VectorValidationError('벡터 문서 개수 제한을 초과했습니다.');
          for (const asset of command.assets ?? []) {
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(asset.id) || ['__proto__', 'prototype', 'constructor'].includes(asset.id) || asset.mime !== 'image/png' || typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 160 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(asset.name)) throw new VectorValidationError('벡터 이미지 에셋이 올바르지 않습니다.');
            const existing = p.assets[asset.id];
            if (existing && !sameAsset(existing, asset)) throw new VectorValidationError('기존 에셋 ID의 원본을 변경할 수 없습니다.');
            if (!existing && Object.keys(p.assets).length >= PROJECT_LIMITS.assets) throw new VectorValidationError('프로젝트 에셋 개수 제한을 초과했습니다.');
            const bytes = dataUrlToBytes(asset.data, asset.mime); validateAssetBytes(bytes, asset.mime); p.assets[asset.id] = copy(asset);
          }
          const totalBytes = Object.values(p.assets).reduce((sum, asset) => { const encoded = asset.data.slice(asset.data.indexOf(',') + 1); return sum + encoded.length * .75 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0); }, 0);
          if (totalBytes > PROJECT_LIMITS.expandedBytes - PROJECT_LIMITS.manifestBytes) throw new VectorValidationError('프로젝트 에셋 총 크기 제한을 초과했습니다.');
          const document = validateVectorDocument(command.document, p.assets);
          p.vectorDocuments = { ...documents, [document.id]: document }; p.version = 2;
          // Removing an artboard removes its placements in the same undo unit.
          p.layers = p.layers.filter(layer => layer.type !== 'vector' || layer.vectorDocumentId !== document.id || document.artboards.some(artboard => artboard.id === layer.vectorArtboardId));
          selected = survivingSelection(p, selected);
          // The archive stores asset paths, never data URLs in its manifest.
          // Check this before committing so every accepted vector edit is savable.
          const manifest = { ...p, assets: Object.fromEntries(Object.entries(p.assets).map(([id, asset]) => [id, { ...asset, data: `assets/${id}.${asset.mime === 'image/png' ? 'png' : 'glb'}` }])) };
          if (new TextEncoder().encode(JSON.stringify(manifest)).length > PROJECT_LIMITS.manifestBytes) throw new VectorValidationError('프로젝트의 편집 데이터가 2 MiB 저장 한도를 초과했습니다. 경로를 단순화하거나 문서를 나누세요.');
          break;
        }
        case 'vector.document.remove': {
          if (!p.vectorDocuments || !Object.hasOwn(p.vectorDocuments, command.documentId)) return;
          delete p.vectorDocuments[command.documentId];
          p.layers = p.layers.filter(layer => layer.type !== 'vector' || layer.vectorDocumentId !== command.documentId);
          selected = survivingSelection(p, selected); break;
        }
        case 'vector.garment.bind': {
          const document = p.vectorDocuments?.[command.documentId]; const artboard = document?.artboards.find(artboard => artboard.id === command.artboardId);
          if (!document || !artboard || !Object.hasOwn(p.regions, command.regionId)) return;
          const existing = command.layerId ? p.layers.find(layer => layer.id === command.layerId) : p.layers.find(layer => layer.type === 'vector' && layer.vectorDocumentId === document.id && layer.vectorArtboardId === artboard.id && layer.regionId === command.regionId);
          if (command.layerId && !existing || existing && (existing.type !== 'vector' || existing.locked)) return;
          if (existing) {
            existing.vectorDocumentId = document.id; existing.vectorArtboardId = artboard.id; existing.regionId = command.regionId;
            selected = existing.id;
          } else {
            if (p.layers.length >= PROJECT_LIMITS.layers) return;
            const layer: ArtworkLayer = { id: crypto.randomUUID(), type: 'vector', name: document.name.slice(0, 160), vectorDocumentId: document.id, vectorArtboardId: artboard.id, regionId: command.regionId, x: .5, y: .5, width: clamp(.5 * Math.min(1, artboard.width / artboard.height), .00001, 20), height: clamp(.5 * Math.min(1, artboard.height / artboard.width), .00001, 20), rotation: 0, opacity: 1, visible: true, locked: false };
            p.layers.push(layer); selected = layer.id;
          }
          p.version = 2; break;
        }
        case 'vector.garment.unbind': {
          const layer = p.layers.find(layer => layer.id === command.layerId); if (!layer || layer.type !== 'vector' || layer.locked) return;
          p.layers = p.layers.filter(item => item.id !== layer.id); selected = survivingSelection(p, selected); break;
        }
      }
      if (sameContent(p, state.project)) return;
      p.updatedAt = nextTimestamp(state.project.updatedAt);
      set({ project: p, past: state.group ? state.past : [...state.past, state.project].slice(-100), future: [], dirty: isDirty(p), selectedLayer: selected, lastCommand: commandLabel(command) });
    },
    beginGroup() { if (!get().group) set({ group: copy(get().project) }); },
    endGroup() {
      const s = get(); if (!s.group) return;
      const changed = !sameContent(s.group, s.project);
      set({ past: changed ? [...s.past, s.group].slice(-100) : s.past, group: null });
    },
    undo() {
      get().endGroup(); const s = get(); if (!s.past.length) return;
      const project = s.past.at(-1)!;
      set({ project, past: s.past.slice(0, -1), future: [s.project, ...s.future], selectedLayer: survivingSelection(project, s.selectedLayer), dirty: isDirty(project), lastCommand: '실행 취소', group: null });
    },
    redo() {
      get().endGroup(); const s = get(); if (!s.future.length) return;
      const project = s.future[0]!;
      set({ project, past: [...s.past, s.project].slice(-100), future: s.future.slice(1), selectedLayer: survivingSelection(project, s.selectedLayer), dirty: isDirty(project), lastCommand: '다시 실행', group: null });
    },
    replace(project, dirty = false) {
      const document = copy(project); savedContent = dirty ? null : copy(document);
      set({ project: document, past: [], future: [], group: null, selectedLayer: null, dirty, lastCommand: '프로젝트 열기' });
    },
    newProject(kind = 'tshirt') { get().replace(createProject(kind)); },
    selectRegion(id) {
      const s = get(); if (!s.project.regions[id]) return;
      if (s.project.activeRegion === id) return;
      set({ project: { ...s.project, activeRegion: id }, selectedLayer: null });
    },
    selectLayer(id) {
      const s = get(); const layer = s.project.layers.find(item => item.id === id);
      set({ selectedLayer: layer?.id ?? null, ...(layer ? { project: { ...s.project, activeRegion: layer.regionId } } : {}) });
    },
    copyLayer() {
      const s = get(); const layer = s.project.layers.find(item => item.id === s.selectedLayer);
      if (!layer) return false;
      const asset = layer.assetId ? s.project.assets[layer.assetId] : undefined;
      const vectorDocument = layer.type === 'vector' ? s.project.vectorDocuments?.[layer.vectorDocumentId ?? ''] : undefined;
      if (layer.type === 'vector' && !vectorDocument) return false;
      const vectorAssets = vectorDocument?.assets.map(id => s.project.assets[id]!);
      clipboard = copy({ layer, ...(asset ? { asset } : {}), ...(vectorDocument ? { vectorDocument, vectorAssets } : {}) }); pasteCount = 0;
      set({ canPaste: true, lastCommand: '레이어 복사' }); return true;
    },
    pasteLayer() {
      if (!clipboard) return false;
      get().endGroup(); const s = get(); const source = copy(clipboard);
      if (s.project.layers.length >= PROJECT_LIMITS.layers) return false;
      const nextPaste = pasteCount + 1;
      const layer: ArtworkLayer = { ...source.layer, id: crypto.randomUUID(), name: `${source.layer.name.slice(0, 154)} 붙여넣기`, regionId: s.project.activeRegion, x: clamp(source.layer.x + .025 * nextPaste, -10, 10), y: clamp(source.layer.y + .025 * nextPaste, -10, 10), locked: false };
      let asset: AssetRecord | undefined;
      if (source.asset) {
        const existing = Object.values(s.project.assets).find(item => item.mime === source.asset!.mime && item.data === source.asset!.data);
        layer.assetId = existing?.id ?? crypto.randomUUID();
        if (!existing) asset = { ...source.asset, id: layer.assetId };
      }
      let vectorDocument: VectorDocument | undefined; const vectorAssets: AssetRecord[] = [];
      if (source.vectorDocument) {
        const existingDocument = s.project.vectorDocuments?.[source.vectorDocument.id];
        if (!existingDocument || JSON.stringify(existingDocument) !== JSON.stringify(source.vectorDocument) || (source.vectorAssets ?? []).some(asset => s.project.assets[asset.id]?.data !== asset.data || s.project.assets[asset.id]?.mime !== asset.mime)) {
          if (Object.keys(s.project.vectorDocuments ?? {}).length >= VECTOR_LIMITS.documents) return false;
          vectorDocument = source.vectorDocument;
          vectorDocument.id = crypto.randomUUID(); layer.vectorDocumentId = vectorDocument.id;
          const assetIds = new Map<string, string>();
          for (const sourceAsset of source.vectorAssets ?? []) {
            const existing = Object.values(s.project.assets).find(item => item.mime === sourceAsset.mime && item.data === sourceAsset.data) ?? vectorAssets.find(item => item.mime === sourceAsset.mime && item.data === sourceAsset.data);
            const id = existing?.id ?? crypto.randomUUID(); assetIds.set(sourceAsset.id, id);
            if (!existing) vectorAssets.push({ ...sourceAsset, id });
          }
          if (Object.keys(s.project.assets).length + vectorAssets.length > PROJECT_LIMITS.assets) return false;
          vectorDocument.assets = vectorDocument.assets.map(id => assetIds.get(id) ?? id);
          for (const object of vectorDocument.objects) if (object.image) object.image.assetId = assetIds.get(object.image.assetId) ?? object.image.assetId;
        }
      }
      // Importing editable vectors and placing them share one existing history unit.
      get().beginGroup();
      try {
        if (vectorDocument) get().execute({ id: 'vector.document.set', document: vectorDocument, assets: vectorAssets });
        get().execute({ id: 'artwork.add', layer, asset });
      } finally { get().endGroup(); }
      if (get().selectedLayer !== layer.id) return false;
      pasteCount = nextPaste; set({ lastCommand: '레이어 붙여넣기' }); return true;
    },
    setCamera(camera) {
      const s = get();
      if (JSON.stringify(s.project.camera) !== JSON.stringify(camera)) {
        const project = { ...s.project, camera: copy(camera), updatedAt: nextTimestamp(s.project.updatedAt) };
        set({ project, dirty: isDirty(project) });
      }
    },
    markSaved(projectId, updatedAt) {
      const s = get();
      if (s.project.id !== projectId) return;
      const revision = [s.project, ...s.past, ...s.future, ...(s.group ? [s.group] : [])].find(project => project.id === projectId && project.updatedAt === updatedAt);
      if (revision) { savedContent = copy(revision); set({ dirty: isDirty(s.project) }); }
    },
  };
});
