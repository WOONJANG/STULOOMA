import type { VectorDocument, VectorMatrix, VectorObject } from '../../types/vector';

export const identityVectorMatrix = (): VectorMatrix => [1, 0, 0, 1, 0, 0];

/** New vectors are created lazily; opening a legacy project never rewrites it. */
export function createVectorDocument(name = '새 벡터 디자인', width = 1024, height = 1024): VectorDocument {
  return {
    id: crypto.randomUUID(), name, version: 1,
    artboards: [{ id: crypto.randomUUID(), name: '아트보드 1', x: 0, y: 0, width, height, unit: 'px', background: null }],
    objects: [], assets: [],
  };
}

export function createVectorObject(type: VectorObject['type'], artboardId: string, patch: Partial<VectorObject> = {}): VectorObject {
  const defaults: VectorObject = {
    id: crypto.randomUUID(), name: type === 'group' ? '그룹' : type === 'text' ? '텍스트' : type === 'image' ? '이미지' : '패스',
    type, parentId: null, artboardId, transform: identityVectorMatrix(), opacity: 1, visible: true, locked: false,
    fill: { type: 'solid', color: '#68e1b4', opacity: 1 },
    stroke: { paint: { type: 'none' }, width: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 4, dash: [], dashOffset: 0 },
    ...(type === 'path' ? { geometry: { contours: [], fillRule: 'nonzero' } as const } : {}),
    ...(type === 'text' ? { text: { content: '텍스트', fontFamily: 'Noto Sans KR Variable', fontSize: 48, fontWeight: 400, letterSpacing: 0, lineHeight: 1.2, alignment: 'start' } as const } : {}),
  };
  return structuredClone({ ...defaults, ...patch, type, artboardId });
}

export function multiplyVectorMatrices(a: VectorMatrix, b: VectorMatrix): VectorMatrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

/** Returns local-to-document transform, without viewport zoom or artboard offset. */
export function vectorWorldMatrix(document: VectorDocument, objectId: string): VectorMatrix {
  const objects = new Map(document.objects.map(object => [object.id, object]));
  const chain: VectorObject[] = []; const visited = new Set<string>();
  let object = objects.get(objectId);
  if (!object) throw new Error('벡터 객체를 찾을 수 없습니다.');
  while (object) {
    if (visited.has(object.id) || chain.length >= 64) throw new Error('벡터 계층이 순환하거나 너무 깊습니다.');
    visited.add(object.id); chain.push(object);
    if (!object.parentId) break;
    object = objects.get(object.parentId);
    if (!object) throw new Error('상위 벡터 그룹을 찾을 수 없습니다.');
  }
  return chain.reverse().reduce((matrix, item) => multiplyVectorMatrices(matrix, item.transform), identityVectorMatrix());
}

/** Prevents moving a child twice when its selected ancestor already moves it. */
export function selectedVectorRoots(document: VectorDocument, selectedIds: readonly string[]): VectorObject[] {
  const objects = new Map(document.objects.map(object => [object.id, object])); const selected = new Set(selectedIds);
  return document.objects.filter(object => {
    if (!selected.has(object.id)) return false;
    const visited = new Set<string>(); let parent = object.parentId;
    while (parent) {
      if (selected.has(parent)) return false;
      if (visited.has(parent)) return false;
      visited.add(parent); parent = objects.get(parent)?.parentId ?? null;
    }
    return true;
  });
}
