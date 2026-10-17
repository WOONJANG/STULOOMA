import type { AssetRecord } from '../../types/project';
export function bytesToDataURL(bytes: Uint8Array, mime: string): string {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export async function importPNG(file: File): Promise<AssetRecord> {
  if (file.size > 16 * 1024 * 1024) throw new Error('PNG는 16 MB 이하로 선택하세요.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 33 || [137,80,78,71,13,10,26,10].some((v, i) => bytes[i] !== v)) throw new Error('유효한 PNG 파일이 아닙니다.');
  const view = new DataView(bytes.buffer); const w = view.getUint32(16), h = view.getUint32(20);
  if (!w || !h || w > 8192 || h > 8192 || w * h > 32e6) throw new Error('이미지는 8192px 및 3,200만 픽셀 이하로 선택하세요.');
  const data = bytesToDataURL(bytes, 'image/png');
  const image = new Image(); image.src = data; await image.decode();
  return { id: crypto.randomUUID(), name: file.name, mime: 'image/png', data };
}
