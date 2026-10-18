import type { AssetRecord } from '../../types/project';
import type { VectorDocument, VectorMatrix, VectorObject } from '../../types/vector';
import { multiplyVectorMatrices } from './document';

export const VECTOR_LIMITS = Object.freeze({ documents: 32, artboards: 32, objects: 10_000, anchors: 100_000, contours: 10_000, depth: 64, coordinate: 10_000_000, matrix: 1_000_000, worldMatrix: 1_000_000_000_000, stops: 64 });
export class VectorValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'VectorValidationError'; }
}
const fail = (message: string): never => { throw new VectorValidationError(`벡터: ${message}`); };
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label}: 객체가 필요합니다.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(`${label}: 일반 JSON 객체가 필요합니다.`);
  for (const key of Object.keys(value)) if (forbidden.has(key)) fail(`${label}: 허용되지 않는 키입니다.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key}: 지원하지 않는 필드입니다.`);
}
function text(value: unknown, label: string, maximum = 160, empty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return fail(`${label}: 문자열이 올바르지 않습니다.`);
  return value;
}
function id(value: unknown, label: string): string {
  const result = text(value, label, 128); if (!identifier.test(result) || forbidden.has(result)) fail(`${label}: ID가 올바르지 않습니다.`); return result;
}
function number(value: unknown, label: string, low: number = -VECTOR_LIMITS.coordinate, high: number = VECTOR_LIMITS.coordinate): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) return fail(`${label}: 유한한 범위 내 숫자가 필요합니다.`);
  return value;
}
function boolean(value: unknown, label: string): void { if (typeof value !== 'boolean') fail(`${label}: 참/거짓 값이 필요합니다.`); }
function color(value: unknown, label: string): void { if (typeof value !== 'string' || !/^#[\da-fA-F]{6}$/.test(value)) fail(`${label}: #RRGGBB 색상이 필요합니다.`); }
function oneOf(value: unknown, choices: readonly string[], label: string): void { if (typeof value !== 'string' || !choices.includes(value)) fail(`${label}: 지원하지 않는 값입니다.`); }
function matrix(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length !== 6) fail(`${label}: 6개 성분의 변환 행렬이 필요합니다.`);
  for (const component of value as unknown[]) number(component, label, -VECTOR_LIMITS.matrix, VECTOR_LIMITS.matrix);
}
function point(value: unknown, label: string): void { const p = record(value, label); keys(p, ['x', 'y'], label); number(p.x, `${label}.x`); number(p.y, `${label}.y`); }
function paint(value: unknown, label: string): void {
  const p = record(value, label);
  if (p.type === 'none') { keys(p, ['type'], label); return; }
  if (p.type === 'solid') { keys(p, ['type', 'color', 'opacity'], label); color(p.color, label); number(p.opacity, `${label}.opacity`, 0, 1); return; }
  const linear = p.type === 'linear';
  if (!linear && p.type !== 'radial') fail(`${label}: 지원하지 않는 채우기입니다.`);
  const coordinates = linear ? ['x1', 'y1', 'x2', 'y2'] : ['cx', 'cy', 'r', 'fx', 'fy'];
  keys(p, ['type', 'units', 'transform', 'stops', ...coordinates], label);
  for (const key of coordinates) number(p[key], `${label}.${key}`, key === 'r' ? .000001 : -VECTOR_LIMITS.coordinate);
  oneOf(p.units, ['objectBoundingBox', 'userSpaceOnUse'], `${label}.units`); matrix(p.transform, `${label}.transform`);
  if (!Array.isArray(p.stops) || p.stops.length < 1 || p.stops.length > VECTOR_LIMITS.stops) fail(`${label}: 그라디언트 스톱 수 제한을 초과했습니다.`);
  let previous = -1;
  for (const value of p.stops as unknown[]) {
    const stop = record(value, 'stop'); keys(stop, ['offset', 'color', 'opacity'], 'stop');
    const offset = number(stop.offset, 'stop.offset', 0, 1); if (offset < previous) fail('그라디언트 스톱 순서가 올바르지 않습니다.'); previous = offset;
    color(stop.color, 'stop.color'); number(stop.opacity, 'stop.opacity', 0, 1);
  }
}
function metadata(value: unknown, depth = 0, budget = { count: 0 }): void {
  if (depth > 16 || ++budget.count > 10_000) fail('메타데이터 복잡도 제한을 초과했습니다.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { number(value, 'metadata', -Number.MAX_VALUE, Number.MAX_VALUE); return; }
  if (typeof value === 'string') { text(value, 'metadata', 64 * 1024, true); return; }
  if (Array.isArray(value)) { for (const item of value) metadata(item, depth + 1, budget); return; }
  for (const [key, item] of Object.entries(record(value, 'metadata'))) { text(key, 'metadata key'); metadata(item, depth + 1, budget); }
}

/** Validates editable data only. No SVG markup, scripts, URLs or GPU objects enter the document. */
export function validateVectorDocument(input: unknown, assets?: Record<string, AssetRecord>): VectorDocument {
  const doc = record(input, 'document'); keys(doc, ['id', 'name', 'version', 'artboards', 'objects', 'assets', 'metadata'], 'document');
  id(doc.id, 'document.id'); text(doc.name, 'document.name'); if (doc.version !== 1) fail('지원하지 않는 벡터 문서 버전입니다.');
  if (!Array.isArray(doc.artboards) || doc.artboards.length < 1 || doc.artboards.length > VECTOR_LIMITS.artboards) fail('아트보드 개수 제한을 초과했습니다.');
  const artboardIds = new Set<string>(); const allIds = new Set<string>();
  for (const value of doc.artboards as unknown[]) {
    const artboard = record(value, 'artboard'); keys(artboard, ['id', 'name', 'x', 'y', 'width', 'height', 'unit', 'background'], 'artboard');
    const key = id(artboard.id, 'artboard.id'); if (allIds.has(key)) fail('아트보드 ID가 중복되었습니다.'); allIds.add(key); artboardIds.add(key);
    text(artboard.name, 'artboard.name'); number(artboard.x, 'artboard.x'); number(artboard.y, 'artboard.y');
    number(artboard.width, 'artboard.width', .000001); number(artboard.height, 'artboard.height', .000001);
    oneOf(artboard.unit, ['px', 'mm', 'cm', 'pt'], 'artboard.unit'); if (artboard.background !== null) color(artboard.background, 'artboard.background');
  }
  if (!Array.isArray(doc.assets) || doc.assets.length > 64) fail('문서 에셋 수 제한을 초과했습니다.');
  const assetIds = new Set<string>();
  for (const value of doc.assets as unknown[]) {
    const key = id(value, 'document.assets'); if (assetIds.has(key)) fail('문서 에셋 ID가 중복되었습니다.'); assetIds.add(key);
    if (assets && (!Object.hasOwn(assets, key) || assets[key]?.mime !== 'image/png')) fail('벡터 이미지의 원본 PNG 에셋을 찾을 수 없습니다.');
  }
  if (!Array.isArray(doc.objects) || doc.objects.length > VECTOR_LIMITS.objects) fail('벡터 객체 수 제한을 초과했습니다.');
  const objectMap = new Map<string, VectorObject>(); let anchors = 0, contours = 0;
  for (const value of doc.objects as unknown[]) {
    const object = record(value, 'object'); keys(object, ['id', 'name', 'type', 'parentId', 'artboardId', 'transform', 'opacity', 'visible', 'locked', 'fill', 'stroke', 'geometry', 'text', 'image', 'clipPathId', 'maskId'], 'object');
    const key = id(object.id, 'object.id'); if (allIds.has(key)) fail('벡터 객체 ID가 중복되었습니다.'); allIds.add(key);
    text(object.name, 'object.name'); oneOf(object.type, ['path', 'group', 'text', 'image'], 'object.type');
    if (object.parentId !== null) id(object.parentId, 'object.parentId');
    if (!artboardIds.has(id(object.artboardId, 'object.artboardId'))) fail('존재하지 않는 아트보드 참조입니다.');
    matrix(object.transform, 'object.transform'); number(object.opacity, 'object.opacity', 0, 1); boolean(object.visible, 'object.visible'); boolean(object.locked, 'object.locked'); paint(object.fill, 'object.fill');
    const stroke = record(object.stroke, 'stroke'); keys(stroke, ['paint', 'width', 'lineCap', 'lineJoin', 'miterLimit', 'dash', 'dashOffset'], 'stroke'); paint(stroke.paint, 'stroke.paint');
    number(stroke.width, 'stroke.width', 0, 100_000); number(stroke.miterLimit, 'stroke.miterLimit', 1, 10_000); number(stroke.dashOffset, 'stroke.dashOffset');
    oneOf(stroke.lineCap, ['butt', 'round', 'square'], 'stroke.lineCap'); oneOf(stroke.lineJoin, ['miter', 'round', 'bevel'], 'stroke.lineJoin');
    if (!Array.isArray(stroke.dash) || stroke.dash.length > 256) fail('대시 패턴 수 제한을 초과했습니다.');
    for (const dash of stroke.dash as unknown[]) number(dash, 'stroke.dash', 0, 100_000);
    if (object.type !== 'path' && object.geometry !== undefined || object.type !== 'text' && object.text !== undefined || object.type !== 'image' && object.image !== undefined) fail('객체 유형과 편집 데이터가 일치하지 않습니다.');
    if (object.type === 'path') {
      const geometry = record(object.geometry, 'geometry'); keys(geometry, ['contours', 'fillRule'], 'geometry'); oneOf(geometry.fillRule, ['nonzero', 'evenodd'], 'geometry.fillRule');
      if (!Array.isArray(geometry.contours) || (contours += geometry.contours.length) > VECTOR_LIMITS.contours) fail('패스 윤곽 수 제한을 초과했습니다.');
      const anchorIds = new Set<string>();
      for (const value of geometry.contours as unknown[]) {
        const contour = record(value, 'contour'); keys(contour, ['anchors', 'closed'], 'contour'); boolean(contour.closed, 'contour.closed');
        if (!Array.isArray(contour.anchors) || (anchors += contour.anchors.length) > VECTOR_LIMITS.anchors) fail('앵커 수 제한을 초과했습니다.');
        for (const value of contour.anchors as unknown[]) {
          const anchor = record(value, 'anchor'); keys(anchor, ['id', 'x', 'y', 'in', 'out', 'kind'], 'anchor'); const key = id(anchor.id, 'anchor.id');
          if (anchorIds.has(key)) fail('패스 안의 앵커 ID가 중복되었습니다.'); anchorIds.add(key);
          number(anchor.x, 'anchor.x'); number(anchor.y, 'anchor.y'); oneOf(anchor.kind, ['corner', 'smooth', 'symmetric'], 'anchor.kind');
          if (anchor.in !== undefined) point(anchor.in, 'anchor.in'); if (anchor.out !== undefined) point(anchor.out, 'anchor.out');
        }
      }
    } else if (object.type === 'text') {
      const t = record(object.text, 'text'); keys(t, ['content', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'alignment'], 'text');
      text(t.content, 'text.content', 20_000, true); text(t.fontFamily, 'text.fontFamily', 256); number(t.fontSize, 'text.fontSize', .001, 100_000); number(t.fontWeight, 'text.fontWeight', 1, 1000);
      number(t.letterSpacing, 'text.letterSpacing', -100_000, 100_000); number(t.lineHeight, 'text.lineHeight', .01, 1000); oneOf(t.alignment, ['start', 'middle', 'end'], 'text.alignment');
    } else if (object.type === 'image') {
      const image = record(object.image, 'image'); keys(image, ['assetId', 'width', 'height'], 'image');
      if (!assetIds.has(id(image.assetId, 'image.assetId'))) fail('이미지가 문서 에셋 목록을 참조하지 않습니다.');
      number(image.width, 'image.width', .000001); number(image.height, 'image.height', .000001);
    }
    if (object.clipPathId !== undefined) id(object.clipPathId, 'object.clipPathId'); if (object.maskId !== undefined) id(object.maskId, 'object.maskId');
    objectMap.set(key, object as unknown as VectorObject);
  }
  const children = new Map<string, string[]>();
  for (const object of objectMap.values()) {
    if (object.parentId !== null) {
      const parent = objectMap.get(object.parentId); if (!parent || parent.type !== 'group' || parent.artboardId !== object.artboardId) return fail('상위 그룹 참조가 올바르지 않습니다.');
      children.set(parent.id, [...(children.get(parent.id) ?? []), object.id]);
    }
    for (const key of ['clipPathId', 'maskId'] as const) if (object[key] !== undefined) {
      const target = objectMap.get(object[key]!);
      if (!target || target.artboardId !== object.artboardId || target.id === object.id || key === 'clipPathId' && target.type !== 'path' && target.type !== 'group') fail('클리핑/마스크 참조가 올바르지 않습니다.');
    }
  }
  const colors = new Map<string, number>(); const heights = new Map<string, number>();
  const inspect = (key: string, depth: number): number => {
    if (depth > VECTOR_LIMITS.depth || colors.get(key) === 1) fail('벡터 그룹/클리핑 계층이 순환하거나 너무 깊습니다.');
    if (colors.get(key) === 2) return heights.get(key)!; colors.set(key, 1);
    const object = objectMap.get(key)!;
    let height = 1;
    for (const child of [...(children.get(key) ?? []), ...(object.clipPathId ? [object.clipPathId] : []), ...(object.maskId ? [object.maskId] : [])]) height = Math.max(height, 1 + inspect(child, depth + 1));
    if (height > VECTOR_LIMITS.depth) fail('벡터 그룹/클리핑 계층이 너무 깊습니다.');
    colors.set(key, 2); heights.set(key, height); return height;
  };
  for (const key of objectMap.keys()) inspect(key, 1);
  const world = new Map<string, VectorMatrix>();
  const inspectWorld = (object: VectorObject, depth = 1): VectorMatrix => {
    if (depth > VECTOR_LIMITS.depth) return fail('벡터 그룹 계층이 너무 깊습니다.');
    const cached = world.get(object.id); if (cached) return cached;
    const result = object.parentId ? multiplyVectorMatrices(inspectWorld(objectMap.get(object.parentId)!, depth + 1), object.transform) : object.transform;
    for (const value of result) number(value, '월드 변환', -VECTOR_LIMITS.worldMatrix, VECTOR_LIMITS.worldMatrix);
    world.set(object.id, result); return result;
  };
  for (const object of objectMap.values()) inspectWorld(object);
  if (doc.metadata !== undefined) { record(doc.metadata, 'metadata'); metadata(doc.metadata); if (JSON.stringify(doc.metadata).length > 512 * 1024) fail('메타데이터 크기 제한을 초과했습니다.'); }
  return structuredClone(doc) as unknown as VectorDocument;
}
