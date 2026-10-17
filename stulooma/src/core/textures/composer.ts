import type { ArtworkLayer, ProjectDocument } from '../../types/project';

// Only local PNG assets are accepted. Keeping decoded images in a small LRU avoids
// decoding an artwork again for every drag while still releasing old projects.
const decodedImages = new Map<string, Promise<HTMLImageElement>>();
const MAX_DECODED_IMAGES = 24;
const TEXT_FONT_FAMILY = '"Noto Sans KR Variable"';

function textFont(layer: ArtworkLayer, size: number): string {
  return `700 ${(layer.fontSize ?? 80) * size / 1024}px ${TEXT_FONT_FAMILY}`;
}

function loadPNG(data: string): Promise<HTMLImageElement> {
  if (!data.startsWith('data:image/png;base64,')) {
    return Promise.reject(new Error('로컬 PNG 이미지 데이터만 사용할 수 있습니다.'));
  }
  const cached = decodedImages.get(data);
  if (cached) {
    decodedImages.delete(data);
    decodedImages.set(data, cached);
    return cached;
  }
  const decoded = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      decodedImages.delete(data);
      reject(new Error('PNG 이미지를 읽을 수 없습니다.'));
    };
    img.src = data;
  });
  decodedImages.set(data, decoded);
  while (decodedImages.size > MAX_DECODED_IMAGES) {
    decodedImages.delete(decodedImages.keys().next().value!);
  }
  return decoded;
}

export function clearTextureImageCache(): void {
  decodedImages.clear();
}

export function layerTransform(layer: ArtworkLayer, size: number) {
  return {
    x: layer.x * size,
    y: layer.y * size,
    width: layer.width * size,
    height: layer.height * size,
    radians: layer.rotation * Math.PI / 180,
  };
}

/** Compose the same region surface used by the 2D editor and the 3D material. */
export async function composeRegion(
  project: ProjectDocument,
  regionId: string,
  size = 1024,
): Promise<HTMLCanvasElement> {
  if (!Number.isInteger(size) || size < 1 || size > 4096) {
    throw new Error('텍스처 크기는 1~4096 픽셀이어야 합니다.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다.');
  ctx.fillStyle = project.regions[regionId]?.color ?? '#e8e6e0';
  ctx.fillRect(0, 0, size, size);
  const layers = project.layers.filter(layer => layer.regionId === regionId && layer.visible);
  const [images] = await Promise.all([
    Promise.all(layers.map(async layer => {
      const asset = layer.assetId ? project.assets[layer.assetId] : undefined;
      return layer.type === 'image' && asset ? loadPNG(asset.data) : undefined;
    })),
    // Korean webfonts are split by Unicode range. Request each actual text so
    // the relevant local subsets finish loading before baking pixels into UVs.
    Promise.all(layers.filter(layer => layer.type === 'text' && layer.text).map(async layer => {
      if (document.fonts) await document.fonts.load(textFont(layer, size), layer.text);
    })),
  ]);
  layers.forEach((layer, index) => {
    const transform = layerTransform(layer, size);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    ctx.translate(transform.x, transform.y);
    ctx.rotate(transform.radians);
    if (layer.type === 'image') {
      const img = images[index];
      if (img) ctx.drawImage(img, -transform.width / 2, -transform.height / 2, transform.width, transform.height);
    } else {
      const fontSize = (layer.fontSize ?? 80) * size / 1024;
      ctx.font = `${textFont(layer, size)}, "Malgun Gothic", system-ui, sans-serif`;
      ctx.fillStyle = layer.color ?? '#141b23';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = (layer.text ?? '').split('\n');
      const lineHeight = fontSize * 1.2;
      lines.forEach((line, lineIndex) => {
        ctx.fillText(line, 0, (lineIndex - (lines.length - 1) / 2) * lineHeight, transform.width);
      });
    }
    ctx.restore();
  });
  return canvas;
}

export async function canvasPNG(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG를 생성할 수 없습니다.')), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}
