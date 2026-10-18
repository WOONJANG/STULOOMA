import { describe, expect, it } from 'vitest';
import { deflateSync, strToU8, zipSync } from 'fflate';
import { bytesToDataUrl, createProject, loadProject, PROJECT_LIMITS, saveProject, validateAssetBytes, validateProject } from '../../src/core/project';
import { inspectDeflate } from '../../src/core/project/deflate';
import { archive, directoryOffset, glb, png, project } from './fixtures';

describe('untrusted project archive defenses', () => {
  it.each(['../evil.png', '/evil.png', 'assets/../evil.png', 'assets\\evil.png', 'assets/logo.png/child', 'C:/evil.png'])('rejects traversal and unauthorized paths: %s', async (name) => {
    const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(createProject())), [name]: new Uint8Array([1]) });
    await expect(loadProject(bytes)).rejects.toThrow(/경로/);
  });
  it('rejects exact and case-insensitive ZIP path collisions', async () => {
    const bytes = zipSync({ 'manifest.json': strToU8('{}'), 'assets/logo.png': png(), 'assets/LOGO.png': png() });
    await expect(loadProject(bytes)).rejects.toThrow(/중복|충돌/);
  });
  it('rejects inflated size claims before decompression', async () => {
    const bytes = archive(createProject()); const view = new DataView(bytes.buffer); view.setUint32(directoryOffset(bytes) + 24, PROJECT_LIMITS.expandedBytes + 1, true);
    await expect(loadProject(bytes)).rejects.toThrow(/크기/);
  });
  it('rejects actual DEFLATE expansion beyond a forged small declared size', async () => {
    const bytes = archive({ filler: 'A'.repeat(1_000_000) }); const view = new DataView(bytes.buffer), directory = directoryOffset(bytes);
    view.setUint32(22, 16, true); view.setUint32(directory + 24, 16, true);
    await expect(loadProject(bytes)).rejects.toThrow(/실제 압축 해제 크기/);
  });
  it('rejects damaged compressed bytes and invalid CRC', async () => {
    const bytes = archive(createProject(), {}, 0); const view = new DataView(bytes.buffer); const nameLength = view.getUint16(26, true); bytes[30 + nameLength + 1] ^= 1;
    await expect(loadProject(bytes)).rejects.toThrow(/체크섬/);
  });
  it('rejects a directory/local size mismatch', async () => {
    const bytes = archive(createProject()); new DataView(bytes.buffer).setUint32(22, 1, true);
    await expect(loadProject(bytes)).rejects.toThrow(/로컬 헤더/);
  });
  it('rejects hidden, unreferenced assets', async () => { await expect(loadProject(archive(createProject(), { 'assets/hidden.png': png() }))).rejects.toThrow(/매니페스트에 없는/); });
  it('rejects a missing asset and mismatched manifest path', async () => {
    const p = project(); p.assets.logo!.data = 'assets/other.png'; await expect(loadProject(archive(p, { 'assets/logo.png': png() }))).rejects.toThrow(/에셋 경로/);
  });
  it('rejects truncated archives, unsupported required versions, and unknown required fields', async () => {
    const bytes = await saveProject(createProject()); await expect(loadProject(bytes.subarray(0, bytes.length - 1))).rejects.toThrow();
    await expect(loadProject(archive({ ...createProject(), version: 3 }))).rejects.toThrow(/버전/);
    expect(() => validateProject({ ...createProject(), requiredFutureData: [] })).toThrow(/필수 구조/);
  });
  it('rejects malformed and prototype-polluting metadata', async () => {
    await expect(loadProject(zipSync({ 'manifest.json': strToU8('{broken') }))).rejects.toThrow(/JSON/);
    const p = createProject(); const text = JSON.stringify(p).replace('"layers":[]', '"metadata":{"__proto__":{"polluted":true}},"layers":[]');
    await expect(loadProject(zipSync({ 'manifest.json': strToU8(text) }))).rejects.toThrow(/허용되지 않는 키/);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it('rejects encrypted entries and streaming size descriptors', async () => {
    for (const flags of [1, 8]) { const bytes = archive(createProject()); const view = new DataView(bytes.buffer); view.setUint16(6, flags, true); view.setUint16(directoryOffset(bytes) + 8, flags, true); await expect(loadProject(bytes)).rejects.toThrow(/암호화|스트리밍/); }
  });
  it('rejects malformed UTF-8 in a manifest', async () => { await expect(loadProject(zipSync({ 'manifest.json': new Uint8Array([123, 34, 255, 34, 58, 49, 125]) }))).rejects.toThrow(/JSON/); });
});

describe('project schema and original asset validation', () => {
  it('rejects mismatched asset IDs, missing references and duplicate layers', () => {
    const mismatch = project(); mismatch.assets.logo!.id = 'other'; expect(() => validateProject(mismatch)).toThrow(/키와 ID/);
    const missing = project(); delete missing.assets.logo; expect(() => validateProject(missing)).toThrow(/PNG 에셋/);
    const duplicate = project(); duplicate.layers.push(duplicate.layers[0]!); expect(() => validateProject(duplicate)).toThrow(/중복 레이어/);
  });
  it('rejects nonfinite transforms, invalid colors, invalid regions and oversized metadata', () => {
    const invalid = project(); invalid.layers[0]!.x = NaN; expect(() => validateProject(invalid)).toThrow(/수치 범위/);
    invalid.layers[0]!.x = 0; invalid.activeRegion = 'MISSING'; expect(() => validateProject(invalid)).toThrow(/존재하지 않는 부위/);
    invalid.activeRegion = 'FRONT'; invalid.regions.FRONT!.color = 'url(http://remote)'; expect(() => validateProject(invalid)).toThrow(/색상/);
    const meta = createProject(); meta.metadata = { huge: 'x'.repeat(65537) }; expect(() => validateProject(meta)).toThrow();
  });
  it('rejects renamed non-PNG files, corrupt PNG chunks, and dangerous dimensions', () => {
    expect(() => validateAssetBytes(strToU8('<svg onload="alert(1)"></svg>'), 'image/png')).toThrow(/PNG/);
    const broken = png(); broken[50] ^= 1; expect(() => validateAssetBytes(broken, 'image/png')).toThrow(/체크섬/);
    const p = project(); p.assets.logo!.data = bytesToDataUrl(glb(), 'image/png'); expect(() => validateProject(p)).toThrow(/PNG/);
  });
  it('rejects invalid GLB magic, truncated chunks, wrong version and network resources', () => {
    const bytes = glb(); bytes[0] = 0; expect(() => validateAssetBytes(bytes, 'model/gltf-binary')).toThrow(/헤더/);
    const version = glb(); new DataView(version.buffer).setUint32(4, 3, true); expect(() => validateAssetBytes(version, 'model/gltf-binary')).toThrow(/버전/);
    const truncated = glb(); new DataView(truncated.buffer).setUint32(12, 0xfffffff0, true); expect(() => validateAssetBytes(truncated, 'model/gltf-binary')).toThrow(/청크/);
    const json = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.com/remote.bin' }] });
    const padded = strToU8(json.padEnd(Math.ceil(json.length / 4) * 4, ' ')), remote = new Uint8Array(20 + padded.length), view = new DataView(remote.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, remote.length, true); view.setUint32(12, padded.length, true); view.setUint32(16, 0x4e4f534a, true); remote.set(padded, 20);
    expect(() => validateAssetBytes(remote, 'model/gltf-binary')).toThrow(/외부 리소스/);
  });
  it('rejects noncanonical base64 and incompatible asset MIME', () => {
    const p = project(); p.assets.logo!.data = 'data:image/png;base64,AAAA==='; expect(() => validateProject(p)).toThrow(/base64/);
    p.assets.logo!.data = 'data:text/html;base64,AAAA'; expect(() => validateProject(p)).toThrow(/MIME/);
  });
});

describe('bounded RFC1951 token scan', () => {
  it('accepts fixed, dynamic and stored valid streams across realistic inputs', () => {
    for (const data of [strToU8('Hello, 서울!'), new Uint8Array(200_000), Uint8Array.from({ length: 12_000 }, (_, i) => (i * 7919) % 256)]) {
      for (const level of [0, 1, 6, 9] as const) expect(() => inspectDeflate(deflateSync(data, { level }), data.length)).not.toThrow();
    }
  });
  it('rejects streams whose actual expansion differs from declared size', () => {
    const compressed = deflateSync(strToU8('A'.repeat(10_000)));
    expect(() => inspectDeflate(compressed, 1)).toThrow(/실제 압축 해제 크기/); expect(() => inspectDeflate(compressed, 20_000)).toThrow(/실제 데이터 길이/);
  });
});
