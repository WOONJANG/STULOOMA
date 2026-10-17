import { inflateSync, strToU8, zipSync } from 'fflate';
import type { AssetRecord, GarmentKind, ProjectDocument } from '../../types/project';
import { bytesToDataUrl, crc32, dataUrlToBytes, fail, PROJECT_LIMITS, validateAssetBytes, validateProject } from '../validation/project';
import { inspectDeflate } from './deflate';
export { bytesToDataUrl, dataUrlToBytes, PROJECT_LIMITS, ProjectValidationError, validateAssetBytes, validateProject } from '../validation/project';

export function createProject(kind: GarmentKind = 'tshirt'): ProjectDocument {
  const timestamp = new Date().toISOString();
  const ids = kind === 'basketball' ? ['FRONT', 'BACK', 'COLLAR', 'LEFT_SIDE', 'RIGHT_SIDE'] : ['FRONT', 'BACK', 'LEFT_SLEEVE', 'RIGHT_SLEEVE', 'COLLAR', 'LEFT_SIDE', 'RIGHT_SIDE'];
  return {
    format: 'STULOOMA', version: 1, id: crypto.randomUUID(), name: '새 프로젝트', createdAt: timestamp, updatedAt: timestamp,
    garment: { kind, name: kind === 'basketball' ? '농구 유니폼' : kind === 'custom' ? '사용자 의류' : '기본 반팔 티셔츠' },
    activeRegion: 'FRONT', regions: Object.fromEntries(ids.map((id) => [id, { color: '#e7e2d9', roughness: 0.85, metalness: 0 }])),
    layers: [], assets: {}, camera: { position: [0, 0, 3.8], target: [0, 0, 0] },
    settings: { textureSize: 1024, background: '#191c21', transparent: false, mode: 'simple' },
  };
}

interface Entry { name: string; compressed: number; expanded: number; crc: number; offset: number; dataOffset: number; method: number; flags: number; end: number }
const decoder = new TextDecoder('utf-8', { fatal: true });

// Inspect BOTH directory and local records before asking the inflater to allocate output.
function inspectArchive(bytes: Uint8Array): Entry[] {
  if (bytes.length < 22 || bytes.length > PROJECT_LIMITS.archiveBytes) fail('프로젝트 파일 크기가 허용 범위를 벗어났습니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 22 - 65535); pos--) {
    if (view.getUint32(pos, true) === 0x06054b50 && pos + 22 + view.getUint16(pos + 20, true) === bytes.length) { end = pos; break; }
  }
  if (end < 0) fail('ZIP: 종료 레코드가 없습니다.');
  const count = view.getUint16(end + 10, true), directoryBytes = view.getUint32(end + 12, true), directory = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || view.getUint16(end + 8, true) !== count || count < 1 || count > PROJECT_LIMITS.assets + 1 || directory + directoryBytes !== end) fail('ZIP: 분할 ZIP, ZIP64 또는 디렉터리 구조를 지원하지 않습니다.');
  const entries: Entry[] = [], names = new Set<string>();
  let cursor = directory, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail('ZIP: 중앙 디렉터리가 손상되었습니다.');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true), expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true), offset = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength + extraLength + commentLength > end || nameLength < 1 || nameLength > 160 || (flags & ~0x0806) !== 0 || (method !== 0 && method !== 8) || view.getUint16(cursor + 34, true) !== 0) fail('ZIP: 암호화, 스트리밍 또는 지원하지 않는 엔트리입니다.');
    let name: string;
    try { name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); } catch { return fail('ZIP: 파일 이름 인코딩이 손상되었습니다.'); }
    if (name !== 'manifest.json' && !/^assets\/[A-Za-z0-9_-]{1,128}\.(?:png|glb)$/.test(name)) fail('ZIP: 경로 순회 또는 허용되지 않는 파일 경로입니다.');
    if (names.has(name.toLowerCase())) fail('ZIP: 중복 또는 충돌하는 파일 경로입니다.'); names.add(name.toLowerCase());
    const maximum = name === 'manifest.json' ? PROJECT_LIMITS.manifestBytes : name.endsWith('.png') ? PROJECT_LIMITS.pngBytes : PROJECT_LIMITS.modelBytes;
    total += expanded;
    if (expanded < 1 || expanded > maximum || total > PROJECT_LIMITS.expandedBytes || compressed < 1 || compressed > bytes.length || (method === 0 && expanded !== compressed)) fail('ZIP: 압축 해제 크기 제한을 초과했거나 크기가 손상되었습니다.');
    if (offset + 30 > directory || view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method || view.getUint32(offset + 14, true) !== crc || view.getUint32(offset + 18, true) !== compressed || view.getUint32(offset + 22, true) !== expanded) fail('ZIP: 로컬 헤더와 디렉터리가 일치하지 않습니다.');
    const localNameLength = view.getUint16(offset + 26, true), localExtraLength = view.getUint16(offset + 28, true);
    const dataOffset = offset + 30 + localNameLength + localExtraLength, dataEnd = dataOffset + compressed;
    if (localNameLength !== nameLength || dataEnd > directory || dataOffset > directory || !bytes.subarray(offset + 30, offset + 30 + localNameLength).every((byte, index) => byte === bytes[cursor + 46 + index])) fail('ZIP: 로컬 파일 경로 또는 크기가 일치하지 않습니다.');
    entries.push({ name, compressed, expanded, crc, offset, dataOffset, method, flags, end: dataEnd });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end || !names.has('manifest.json')) fail('ZIP: 매니페스트 또는 디렉터리 크기가 올바르지 않습니다.');
  let previousEnd = 0;
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) { if (entry.offset !== previousEnd) fail('ZIP: 중첩되거나 숨겨진 로컬 엔트리가 있습니다.'); previousEnd = entry.end; }
  if (previousEnd !== directory) fail('ZIP: 로컬 데이터와 디렉터리가 일치하지 않습니다.');
  // Confirm actual DEFLATE expansion before allocating any decompressed file.
  for (const entry of entries) if (entry.method === 8) inspectDeflate(bytes.subarray(entry.dataOffset, entry.end), entry.expanded);
  return entries;
}

export async function saveProject(project: ProjectDocument): Promise<Uint8Array> {
  const valid = validateProject(project);
  const manifest = structuredClone(valid);
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const [id, asset] of Object.entries(valid.assets)) {
    const path = `assets/${id}.${asset.mime === 'image/png' ? 'png' : 'glb'}`;
    files[path] = dataUrlToBytes(asset.data, asset.mime);
    manifest.assets[id]!.data = path;
  }
  const encoded = strToU8(JSON.stringify(manifest));
  if (encoded.length > PROJECT_LIMITS.manifestBytes) fail('프로젝트 매니페스트 크기 제한을 초과했습니다.');
  files['manifest.json'] = encoded;
  const bytes = zipSync(files, { level: 6 });
  inspectArchive(bytes);
  return bytes;
}

export async function loadProject(input: Uint8Array | ArrayBuffer): Promise<ProjectDocument> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = inspectArchive(bytes);
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  try {
    for (const entry of entries) {
      const compressed = bytes.subarray(entry.dataOffset, entry.end);
      files[entry.name] = entry.method === 0 ? compressed.slice() : inflateSync(compressed, { out: new Uint8Array(entry.expanded) });
    }
  } catch { return fail('ZIP: 압축 데이터가 손상되었습니다.'); }
  for (const entry of entries) if (!files[entry.name] || files[entry.name]!.length !== entry.expanded || crc32(files[entry.name]!) !== entry.crc) fail('ZIP: 데이터 크기 또는 체크섬이 일치하지 않습니다.');
  let manifest: ProjectDocument;
  try { manifest = JSON.parse(decoder.decode(files['manifest.json']!)) as ProjectDocument; } catch { return fail('프로젝트 매니페스트 JSON이 손상되었습니다.'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) fail('프로젝트 매니페스트 구조가 올바르지 않습니다.');
  const used = new Set(['manifest.json']);
  for (const [id, value] of Object.entries(manifest.assets)) {
    const asset = value as AssetRecord;
    if (!asset || typeof asset !== 'object' || (asset.mime !== 'image/png' && asset.mime !== 'model/gltf-binary') || typeof asset.data !== 'string') fail('프로젝트 에셋 구조가 올바르지 않습니다.');
    const path = `assets/${id}.${asset.mime === 'image/png' ? 'png' : 'glb'}`;
    if (asset.data !== path || !files[path] || used.has(path)) fail('프로젝트 에셋 경로가 일치하지 않거나 누락되었습니다.');
    used.add(path); validateAssetBytes(files[path]!, asset.mime); asset.data = bytesToDataUrl(files[path]!, asset.mime);
  }
  if (used.size !== entries.length) fail('ZIP: 매니페스트에 없는 파일이 포함되어 있습니다.');
  return validateProject(manifest);
}
