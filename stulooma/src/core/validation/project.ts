import type { AssetRecord, ProjectDocument } from '../../types/project';
import { SUPPORTED_GLB_REQUIRED_EXTENSIONS } from './glb-policy';
import { validateVectorDocument, VECTOR_LIMITS } from '../vector/validation';

export const PROJECT_LIMITS = Object.freeze({
  archiveBytes: 64 * 1024 * 1024,
  expandedBytes: 96 * 1024 * 1024,
  manifestBytes: 2 * 1024 * 1024,
  pngBytes: 16 * 1024 * 1024,
  modelBytes: 32 * 1024 * 1024,
  pixels: 16_777_216,
  assets: 64,
  layers: 500,
  regions: 32,
});

export class ProjectValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ProjectValidationError'; }
}

export function fail(message: string): never { throw new ProjectValidationError(message); }
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const identifier = /^[a-zA-Z0-9_-]{1,128}$/;
const colorPattern = /^#[0-9a-fA-F]{6}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: 객체가 필요합니다.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label}: 일반 JSON 객체가 필요합니다.`);
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (forbidden.has(key)) fail(`${label}: 허용되지 않는 키입니다.`);
  return result;
}

function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key}: 지원하지 않는 필수 구조입니다. metadata에 선택 정보를 저장하세요.`);
}

function str(value: unknown, label: string, max = 160, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${label}: 문자열이 올바르지 않습니다.`);
  return value;
}

function id(value: unknown, label: string): string {
  const result = str(value, label, 128);
  if (!identifier.test(result) || forbidden.has(result)) fail(`${label}: 식별자가 올바르지 않습니다.`);
  return result;
}

function num(value: unknown, label: string, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(`${label}: 수치 범위를 벗어났습니다.`);
  return value;
}

function bool(value: unknown, label: string): void { if (typeof value !== 'boolean') fail(`${label}: 참/거짓 값이 필요합니다.`); }
function color(value: unknown, label: string): void { if (typeof value !== 'string' || !colorPattern.test(value)) fail(`${label}: #RRGGBB 색상이 필요합니다.`); }

function jsonMetadata(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (depth > 16 || ++budget.nodes > 10_000) fail('metadata: 너무 복잡합니다.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { str(value, 'metadata', 64 * 1024, true); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('metadata: 유효하지 않은 숫자입니다.'); return; }
  if (Array.isArray(value)) { for (const item of value) jsonMetadata(item, depth + 1, budget); return; }
  const obj = record(value, 'metadata');
  for (const [key, item] of Object.entries(obj)) { str(key, 'metadata key', 160); jsonMetadata(item, depth + 1, budget); }
}

export function bytesToDataUrl(bytes: Uint8Array, mime: AssetRecord['mime']): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}

export function dataUrlToBytes(data: string, mime: AssetRecord['mime']): Uint8Array {
  const prefix = `data:${mime};base64,`;
  const maximum = mime === 'image/png' ? PROJECT_LIMITS.pngBytes : PROJECT_LIMITS.modelBytes;
  if (typeof data !== 'string' || !data.startsWith(prefix)) fail('에셋: MIME과 data URL이 일치하지 않습니다.');
  const encoded = data.slice(prefix.length);
  if (encoded.length === 0 || encoded.length > Math.ceil(maximum / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('에셋: base64 데이터 또는 크기가 올바르지 않습니다.');
  let binary: string;
  try { binary = atob(encoded); } catch { return fail('에셋: base64 데이터를 읽을 수 없습니다.'); }
  if (binary.length > maximum || btoa(binary) !== encoded) fail('에셋: base64 데이터 또는 크기가 올바르지 않습니다.');
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let value = n; for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; crcTable[n] = value >>> 0; }
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateAssetBytes(bytes: Uint8Array, mime: AssetRecord['mime']): void {
  if (mime === 'image/png') {
    if (bytes.length < 57 || bytes.length > PROJECT_LIMITS.pngBytes || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) fail('PNG: 파일 헤더가 올바르지 않습니다.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8, first = true, seenData = false, ended = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) fail('PNG: 청크가 잘렸습니다.');
      const length = view.getUint32(offset);
      const end = offset + length + 12;
      if (end > bytes.length || length > PROJECT_LIMITS.pngBytes) fail('PNG: 청크 크기가 올바르지 않습니다.');
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (!/^[A-Za-z]{4}$/.test(type)) fail('PNG: 청크 이름이 올바르지 않습니다.');
      if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) fail('PNG: 청크 체크섬이 일치하지 않습니다.');
      if (first) {
        if (type !== 'IHDR' || length !== 13) fail('PNG: IHDR 헤더가 필요합니다.');
        const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12);
        if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > PROJECT_LIMITS.pixels) fail('PNG: 이미지 픽셀 수 제한을 초과했습니다.');
        const depth = bytes[offset + 16], typeCode = bytes[offset + 17];
        const allowedDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!allowedDepths[typeCode!]?.includes(depth!) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || ![0, 1].includes(bytes[offset + 20]!)) fail('PNG: 지원하지 않는 이미지 헤더입니다.');
      } else if (type === 'IHDR') fail('PNG: 중복 IHDR입니다.');
      if (type === 'IDAT') seenData = true;
      if (type === 'IEND') { if (length !== 0 || end !== bytes.length || !seenData) fail('PNG: 종료 청크가 올바르지 않습니다.'); ended = true; }
      first = false; offset = end;
    }
    if (!ended) fail('PNG: 종료 청크가 없습니다.');
    return;
  }
  if (bytes.length < 20 || bytes.length > PROJECT_LIMITS.modelBytes) fail('GLB: 파일 크기가 올바르지 않습니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) fail('GLB: 헤더 또는 버전이 올바르지 않습니다.');
  let offset = 12, chunk = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail('GLB: 청크가 잘렸습니다.');
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (length % 4 !== 0 || offset + 8 + length > bytes.length || (chunk === 0 ? type !== 0x4e4f534a : chunk !== 1 || type !== 0x004e4942)) fail('GLB: 청크 구조가 올바르지 않습니다.');
    if (chunk === 0) {
      if (length > PROJECT_LIMITS.manifestBytes) fail('GLB: JSON 크기 제한을 초과했습니다.');
      let json: unknown;
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 8, offset + 8 + length))); } catch { return fail('GLB: JSON이 손상되었습니다.'); }
      const root = record(json, 'GLB');
      if (record(root.asset, 'GLB.asset').version !== '2.0') fail('GLB: glTF 2.0 에셋이 필요합니다.');
      // Match the importer: resources must be embedded in the GLB BIN chunk;
      // even data URIs are rejected, including URI fields inside extensions.
      let visited = 0;
      const inspect = (value: unknown, depth: number): void => {
        if (depth > 128 || ++visited > 200_000) fail('GLB: 메타데이터 복잡도 제한을 초과했습니다.');
        if (value === null || typeof value !== 'object') return;
        if (Array.isArray(value)) { for (const item of value) inspect(item, depth + 1); return; }
        for (const [key, item] of Object.entries(record(value, 'GLB metadata'))) {
          if (/uri$/i.test(key) && item !== undefined) fail('GLB: 외부 리소스 URI를 허용하지 않습니다. BIN 청크에 포함하세요.');
          inspect(item, depth + 1);
        }
      };
      inspect(root, 0);
      if (root.extensionsRequired !== undefined && (!Array.isArray(root.extensionsRequired) || root.extensionsRequired.some(extension => typeof extension !== 'string' || !SUPPORTED_GLB_REQUIRED_EXTENSIONS.has(extension)))) fail('GLB: 지원하지 않는 필수 확장입니다.');
    }
    offset += 8 + length; chunk++;
  }
}

export function validateProject(input: unknown): ProjectDocument {
  const p = record(input, '프로젝트');
  keys(p, ['format', 'version', 'id', 'name', 'createdAt', 'updatedAt', 'garment', 'activeRegion', 'regions', 'layers', 'assets', 'vectorDocuments', 'camera', 'settings', 'metadata'], '프로젝트');
  if (p.format !== 'STULOOMA' || p.version !== 1 && p.version !== 2) fail('지원하지 않는 STULOOMA 프로젝트 형식 또는 필수 버전입니다.');
  if (p.version === 1 && p.vectorDocuments !== undefined) fail('벡터 문서는 프로젝트 형식 버전 2가 필요합니다.');
  id(p.id, 'id'); str(p.name, 'name');
  for (const field of ['createdAt', 'updatedAt']) { const date = str(p[field], field, 40); if (!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) fail(`${field}: 날짜가 올바르지 않습니다.`); }
  const garment = record(p.garment, 'garment');
  keys(garment, ['kind', 'name', 'assetId', 'regionMeshes'], 'garment');
  if (!['tshirt', 'basketball', 'custom'].includes(garment.kind as string)) fail('garment.kind: 지원하지 않는 모델입니다.');
  str(garment.name, 'garment.name');
  const regions = record(p.regions, 'regions');
  if (Object.keys(regions).length < 1 || Object.keys(regions).length > PROJECT_LIMITS.regions) fail('regions: 부위 개수가 올바르지 않습니다.');
  for (const [key, value] of Object.entries(regions)) { id(key, 'region id'); const region = record(value, `regions.${key}`); keys(region, ['color', 'roughness', 'metalness'], 'region'); color(region.color, 'region.color'); num(region.roughness, 'roughness', 0, 1); num(region.metalness, 'metalness', 0, 1); }
  const activeRegion = id(p.activeRegion, 'activeRegion');
  if (!Object.hasOwn(regions, activeRegion)) fail('activeRegion: 존재하지 않는 부위입니다.');
  const assets = record(p.assets, 'assets');
  if (Object.keys(assets).length > PROJECT_LIMITS.assets) fail('assets: 에셋 개수 제한을 초과했습니다.');
  let totalBytes = 0;
  for (const [key, value] of Object.entries(assets)) {
    id(key, 'asset id'); const asset = record(value, `assets.${key}`); keys(asset, ['id', 'name', 'mime', 'data'], 'asset');
    if (asset.id !== key) fail('asset: 키와 ID가 일치하지 않습니다.');
    str(asset.name, 'asset.name');
    if (asset.mime !== 'image/png' && asset.mime !== 'model/gltf-binary') fail('asset: 지원하지 않는 MIME 형식입니다.');
    if (typeof asset.data !== 'string') fail('asset: data URL이 필요합니다.');
    const bytes = dataUrlToBytes(asset.data, asset.mime);
    totalBytes += bytes.length;
    if (totalBytes > PROJECT_LIMITS.expandedBytes - PROJECT_LIMITS.manifestBytes) fail('assets: 총 크기 제한을 초과했습니다.');
    validateAssetBytes(bytes, asset.mime);
  }
  const vectorDocuments = p.vectorDocuments === undefined ? {} : record(p.vectorDocuments, 'vectorDocuments');
  if (Object.keys(vectorDocuments).length > VECTOR_LIMITS.documents) fail('벡터 문서 개수 제한을 초과했습니다.');
  for (const [key, document] of Object.entries(vectorDocuments)) {
    id(key, 'vector document id');
    try {
      const valid = validateVectorDocument(document, assets as unknown as Record<string, AssetRecord>);
      if (valid.id !== key) fail('벡터 문서 키와 ID가 일치하지 않습니다.');
    } catch (error) { fail(error instanceof Error ? error.message : '벡터 문서가 올바르지 않습니다.'); }
  }
  if (garment.assetId !== undefined) { const assetId = id(garment.assetId, 'garment.assetId'); if (!Object.hasOwn(assets, assetId) || record(assets[assetId], 'garment asset').mime !== 'model/gltf-binary') fail('garment.assetId: GLB 에셋을 찾을 수 없습니다.'); }
  if (garment.kind === 'custom' && garment.assetId === undefined) fail('사용자 모델의 GLB 에셋이 필요합니다.');
  if (garment.regionMeshes !== undefined) {
    const mapping = record(garment.regionMeshes, 'regionMeshes'); const meshOwners = new Set<string>();
    if (Object.keys(mapping).length > PROJECT_LIMITS.regions) fail('regionMeshes: 너무 많은 부위입니다.');
    for (const [key, values] of Object.entries(mapping)) {
      if (!Object.hasOwn(regions, key) || !Array.isArray(values) || values.length > 256) fail('regionMeshes: 부위 참조가 올바르지 않습니다.');
      for (const mesh of values) { const name = str(mesh, 'mesh', 256); if (meshOwners.has(name)) fail('regionMeshes: 하나의 메시는 한 부위에만 연결할 수 있습니다.'); meshOwners.add(name); }
    }
  }
  if (!Array.isArray(p.layers) || p.layers.length > PROJECT_LIMITS.layers) fail('layers: 레이어 개수 제한을 초과했습니다.');
  const layerIds = new Set<string>();
  for (const value of p.layers) {
    const layer = record(value, 'layer'); keys(layer, ['id', 'name', 'type', 'regionId', 'assetId', 'vectorDocumentId', 'vectorArtboardId', 'text', 'color', 'fontSize', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked'], 'layer');
    const key = id(layer.id, 'layer.id'); if (layerIds.has(key)) fail('layer.id: 중복 레이어입니다.'); layerIds.add(key);
    str(layer.name, 'layer.name');
    if (!Object.hasOwn(regions, id(layer.regionId, 'layer.regionId'))) fail('layer.regionId: 존재하지 않는 부위입니다.');
    if (layer.type === 'image') { const assetId = id(layer.assetId, 'layer.assetId'); if (!Object.hasOwn(assets, assetId) || record(assets[assetId], 'layer asset').mime !== 'image/png') fail('layer.assetId: PNG 에셋을 찾을 수 없습니다.'); }
    else if (layer.type === 'text') { str(layer.text, 'layer.text', 2000, true); color(layer.color, 'layer.color'); num(layer.fontSize, 'layer.fontSize', 0.001, 1024); }
    else if (layer.type === 'vector') {
      if (p.version !== 2) fail('벡터 연결은 프로젝트 형식 버전 2가 필요합니다.');
      const documentId = id(layer.vectorDocumentId, 'layer.vectorDocumentId');
      const artboardId = id(layer.vectorArtboardId, 'layer.vectorArtboardId');
      const document = Object.hasOwn(vectorDocuments, documentId) ? vectorDocuments[documentId] as { artboards: { id: string }[] } : undefined;
      if (!document || !document.artboards.some(artboard => artboard.id === artboardId)) fail('벡터 연결 문서 또는 아트보드를 찾을 수 없습니다.');
      if (layer.assetId !== undefined || layer.text !== undefined || layer.fontSize !== undefined || layer.color !== undefined) fail('벡터 연결에 래스터/텍스트 데이터가 혼합되었습니다.');
    }
    else fail('layer.type: 지원하지 않는 레이어입니다.');
    if (layer.type !== 'vector' && (layer.vectorDocumentId !== undefined || layer.vectorArtboardId !== undefined)) fail('벡터 참조와 레이어 유형이 일치하지 않습니다.');
    num(layer.x, 'layer.x', -10, 10); num(layer.y, 'layer.y', -10, 10);
    num(layer.width, 'layer.width', 0.00001, 20); num(layer.height, 'layer.height', 0.00001, 20); num(layer.rotation, 'layer.rotation', -36000, 36000); num(layer.opacity, 'layer.opacity', 0, 1);
    bool(layer.visible, 'layer.visible'); bool(layer.locked, 'layer.locked');
  }
  const camera = record(p.camera, 'camera'); keys(camera, ['position', 'target'], 'camera');
  for (const field of ['position', 'target']) { const vector = camera[field]; if (!Array.isArray(vector) || vector.length !== 3) fail(`camera.${field}: 3D 벡터가 필요합니다.`); for (const component of vector) num(component, `camera.${field}`, -1000, 1000); }
  const settings = record(p.settings, 'settings'); keys(settings, ['textureSize', 'background', 'transparent', 'mode'], 'settings');
  if (settings.textureSize !== 1024 && settings.textureSize !== 2048) fail('settings.textureSize: 지원하지 않는 해상도입니다.');
  color(settings.background, 'settings.background'); bool(settings.transparent, 'settings.transparent');
  if (settings.mode !== 'simple' && settings.mode !== 'expert') fail('settings.mode: 지원하지 않는 모드입니다.');
  if (p.metadata !== undefined) { record(p.metadata, 'metadata'); jsonMetadata(p.metadata); if (JSON.stringify(p.metadata).length > 512 * 1024) fail('metadata: 크기 제한을 초과했습니다.'); }
  return structuredClone(p) as unknown as ProjectDocument;
}
