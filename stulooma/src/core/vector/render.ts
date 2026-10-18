import type { AssetRecord } from '../../types/project';
import type { VectorBounds, VectorDocument, VectorObject, VectorPaint, VectorPath } from '../../types/vector';
import { getPathBounds, invertMatrix, multiplyMatrices } from './geometry';
import { textToPath, VECTOR_FONT_FAMILY } from './text';
import { vectorWorldMatrix } from './document';

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const renderCache = new Map<string, { pending: Promise<HTMLCanvasElement>; pixels: number }>();
const assetTokens = new Map<string, string>();
let nextAssetToken = 0;
let renderPixels = 0;
const MAX_IMAGES = 16;
const MAX_RENDERS = 8;
const MAX_CACHED_PIXELS = 16_777_216;

function assetToken(data: string | undefined): string | undefined {
  if (data === undefined) return undefined;
  const found = assetTokens.get(data);
  if (found) return remember(assetTokens, data, found, MAX_IMAGES);
  // Exact string equality assigns a bounded token; no sampled hashes or copied base64 keys.
  return remember(assetTokens, data, `asset-${++nextAssetToken}`, MAX_IMAGES);
}

function forgetRender(key: string): void {
  const entry = renderCache.get(key);
  if (entry) { renderPixels -= entry.pixels; renderCache.delete(key); }
}

function remember<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
  return value;
}

/** A document-local key: camera, other documents and unrelated assets never invalidate a texture. */
export function vectorDocumentCacheKey(
  vector: VectorDocument, artboardId: string, assets: Record<string, AssetRecord>,
  width = 1024, height = width, transparent = true,
): string {
  const objects = vector.objects.filter(object => object.artboardId === artboardId);
  const imageIds = [...new Set(objects.flatMap(object => object.image ? [object.image.assetId] : []))].sort();
  return JSON.stringify([
    vector.id, vector.artboards.find(artboard => artboard.id === artboardId), objects,
    imageIds.map(id => [id, assets[id]?.mime, assetToken(assets[id]?.data)]), width, height, transparent,
  ]);
}

export function clearVectorRenderCache(): void {
  imageCache.clear();
  renderCache.clear();
  assetTokens.clear();
  renderPixels = 0;
}

export function vectorPath2D(geometry: VectorPath): Path2D {
  const path = new Path2D();
  for (const contour of geometry.contours) {
    const anchors = contour.anchors;
    if (!anchors.length) continue;
    path.moveTo(anchors[0].x, anchors[0].y);
    const count = contour.closed ? anchors.length : anchors.length - 1;
    for (let index = 0; index < count; index++) {
      const start = anchors[index];
      const end = anchors[(index + 1) % anchors.length];
      if (start.out || end.in) {
        const first = start.out ?? start;
        const second = end.in ?? end;
        path.bezierCurveTo(first.x, first.y, second.x, second.y, end.x, end.y);
      } else path.lineTo(end.x, end.y);
    }
    if (contour.closed) path.closePath();
  }
  return path;
}

function pngImage(asset: AssetRecord | undefined): Promise<HTMLImageElement> {
  if (!asset || asset.mime !== 'image/png' || !asset.data.startsWith('data:image/png;base64,')) {
    return Promise.reject(new Error('벡터 문서의 로컬 PNG 에셋을 찾을 수 없습니다.'));
  }
  const cached = imageCache.get(asset.data);
  if (cached) return remember(imageCache, asset.data, cached, MAX_IMAGES);
  const data = asset.data;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { imageCache.delete(data); reject(new Error(`PNG 에셋을 읽을 수 없습니다: ${asset.name}`)); };
    image.src = data;
  });
  return remember(imageCache, data, promise, MAX_IMAGES);
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

function context(surface: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = surface.getContext('2d');
  if (!result) throw new Error('벡터 렌더링 캔버스를 만들 수 없습니다.');
  return result;
}

function rgba(ctx: CanvasRenderingContext2D, color: string, opacity: number): string {
  if (opacity >= 1) return color;
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillStyle = color;
  const normalized = ctx.fillStyle;
  ctx.restore();
  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1);
    const full = hex.length < 5 ? [...hex].map(value => value + value).join('') : hex;
    const rgb = [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16));
    const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return `rgba(${rgb.join(',')},${alpha * opacity})`;
  }
  const match = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const parts = match[1].split(',').map(Number);
    return `rgba(${parts.slice(0, 3).join(',')},${(parts[3] ?? 1) * opacity})`;
  }
  return color;
}

/** Paint through an alpha mask so gradientTransform can affect the paint without
 * changing geometry or stroke width. This also handles elliptical radial paints. */
function paintShape(
  ctx: CanvasRenderingContext2D, value: VectorPaint, bounds: VectorBounds,
  stroke: boolean, draw: (target: CanvasRenderingContext2D) => void,
): void {
  if (value.type === 'none') return;
  if (value.type === 'solid') {
    if (stroke) ctx.strokeStyle = rgba(ctx, value.color, value.opacity);
    else ctx.fillStyle = rgba(ctx, value.color, value.opacity);
    draw(ctx);
    return;
  }
  if (value.units === 'objectBoundingBox' && (bounds.width <= 0 || bounds.height <= 0)) return;
  const surface = canvas(ctx.canvas.width, ctx.canvas.height);
  const mask = context(surface);
  mask.setTransform(ctx.getTransform());
  mask.lineWidth = ctx.lineWidth;
  mask.lineCap = ctx.lineCap;
  mask.lineJoin = ctx.lineJoin;
  mask.miterLimit = ctx.miterLimit;
  mask.setLineDash(ctx.getLineDash());
  mask.lineDashOffset = ctx.lineDashOffset;
  mask.font = ctx.font;
  mask.textAlign = ctx.textAlign;
  mask.textBaseline = ctx.textBaseline;
  mask.fillStyle = mask.strokeStyle = '#ffffff';
  draw(mask);
  mask.globalCompositeOperation = 'source-in';
  if (value.units === 'objectBoundingBox') {
    mask.translate(bounds.x, bounds.y);
    mask.scale(bounds.width, bounds.height);
  }
  mask.transform(...value.transform);
  const gradient = value.type === 'linear'
    ? mask.createLinearGradient(value.x1, value.y1, value.x2, value.y2)
    : mask.createRadialGradient(value.fx, value.fy, 0, value.cx, value.cy, value.r);
  for (const stop of value.stops) gradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), rgba(mask, stop.color, stop.opacity));
  mask.fillStyle = gradient;
  const inverse = mask.getTransform().inverse();
  if (![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) return;
  const corners = [[0, 0], [surface.width, 0], [0, surface.height], [surface.width, surface.height]]
    .map(([x, y]) => inverse.transformPoint({ x, y }));
  const left = Math.min(...corners.map(point => point.x)), right = Math.max(...corners.map(point => point.x));
  const top = Math.min(...corners.map(point => point.y)), bottom = Math.max(...corners.map(point => point.y));
  mask.fillRect(left - 1, top - 1, right - left + 2, bottom - top + 2);
  ctx.save();
  ctx.resetTransform();
  ctx.drawImage(surface, 0, 0);
  ctx.restore();
  surface.width = surface.height = 0;
}

function font(object: VectorObject): string {
  const text = object.text!;
  // Font family comes from a validated local font selection, never a URL.
  return `${text.fontWeight} ${text.fontSize}px ${JSON.stringify(text.fontFamily)}, "Noto Sans KR Variable", sans-serif`;
}

function textLines(ctx: CanvasRenderingContext2D, object: VectorObject): { text: string; width: number; x: number; y: number }[] {
  const text = object.text!;
  return text.content.split('\n').map((line, index) => {
    const glyphs = [...line];
    const width = glyphs.reduce((sum, glyph) => sum + ctx.measureText(glyph).width, 0)
      + Math.max(0, glyphs.length - 1) * text.letterSpacing;
    return { text: line, width, x: text.alignment === 'middle' ? -width / 2 : text.alignment === 'end' ? -width : 0, y: index * text.fontSize * text.lineHeight };
  });
}

function objectBounds(ctx: CanvasRenderingContext2D, object: VectorObject): VectorBounds {
  if (object.geometry) return getPathBounds(object.geometry);
  if (object.image) return { x: 0, y: 0, width: object.image.width, height: object.image.height };
  if (object.text) {
    ctx.font = font(object);
    const lines = textLines(ctx, object);
    const left = Math.min(0, ...lines.map(line => line.x));
    const right = Math.max(0, ...lines.map(line => line.x + line.width));
    return { x: left, y: -object.text.fontSize, width: right - left, height: object.text.fontSize * (1 + (lines.length - 1) * object.text.lineHeight) };
  }
  return { x: 0, y: 0, width: 0, height: 0 };
}

/** Render editable vector geometry directly; no SVG-image rasterization or remote resources. */
export async function renderVectorDocument(
  vector: VectorDocument, artboardId: string, assets: Record<string, AssetRecord>,
  width = 1024, height = width, transparent = true,
): Promise<HTMLCanvasElement> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new Error('벡터 출력 크기는 각 변이 1~4096 픽셀이어야 합니다.');
  }
  const artboard = vector.artboards.find(item => item.id === artboardId);
  if (!artboard) throw new Error('벡터 아트보드를 찾을 수 없습니다.');
  const key = vectorDocumentCacheKey(vector, artboardId, assets, width, height, transparent);
  const cached = renderCache.get(key);
  if (cached) { renderCache.delete(key); renderCache.set(key, cached); return cached.pending; }
  const pending = (async () => {
    const surface = canvas(width, height);
    const ctx = context(surface);
    const objects = vector.objects.filter(object => object.artboardId === artboardId);
    const byId = new Map(objects.map(object => [object.id, object]));
    const children = new Map<string | null, VectorObject[]>();
    const referenced = new Set(objects.flatMap(object => [object.clipPathId, object.maskId].filter((id): id is string => !!id)));
    for (const object of objects) {
      const parent = object.parentId && byId.has(object.parentId) ? object.parentId : null;
      const group = children.get(parent) ?? [];
      group.push(object);
      children.set(parent, group);
    }
    const images = new Map<string, HTMLImageElement>();
    const textOutlines = new Map<string, VectorPath>();
    await Promise.all(objects.map(async object => {
      if (object.type === 'image' && object.image) images.set(object.id, await pngImage(assets[object.image.assetId]));
      if (object.type === 'text' && object.text) {
        if (object.text.fontFamily === VECTOR_FONT_FAMILY && object.text.fontWeight === 400) {
          textOutlines.set(object.id, await textToPath(object.text));
        } else if (document.fonts) await document.fonts.load(font(object), object.text.content);
      }
    }));
    if (!transparent && artboard.background) {
      ctx.fillStyle = artboard.background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.scale(width / artboard.width, height / artboard.height);
    ctx.translate(-artboard.x, -artboard.y);

    function intersectAlpha(target: CanvasRenderingContext2D, alpha: HTMLCanvasElement): void {
      target.save();
      target.resetTransform();
      target.globalCompositeOperation = 'destination-in';
      target.drawImage(alpha, 0, 0);
      target.restore();
      alpha.width = alpha.height = 0;
    }

    /** SVG clip children contribute the union of their individual filled areas.
     * A combined Path2D with one rule would incorrectly fill counters or XOR overlaps. */
    function clipMask(object: VectorObject, base: DOMMatrix, relative: number[], active: Set<string>): HTMLCanvasElement {
      const surface = canvas(width, height);
      const target = context(surface);
      target.setTransform(base);
      const drawClip = (drawing: CanvasRenderingContext2D, source: VectorObject, chain: Set<string>, override?: number[]) => {
        if (chain.has(source.id)) throw new Error('순환 클리핑 경로는 렌더링할 수 없습니다.');
        const nested = new Set(chain).add(source.id);
        drawing.save();
        const matrix = override ?? source.transform;
        drawing.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
        const transformed = drawing.getTransform();
        if (Math.abs(transformed.a * transformed.d - transformed.b * transformed.c) < 1e-14) { drawing.restore(); return; }
        let content = drawing;
        let intermediate: HTMLCanvasElement | undefined;
        if (source.clipPathId) {
          intermediate = canvas(width, height);
          content = context(intermediate);
          content.setTransform(drawing.getTransform());
        }
        content.fillStyle = '#ffffff';
        if (source.geometry) content.fill(vectorPath2D(source.geometry), source.geometry.fillRule);
        for (const child of children.get(source.id) ?? []) {
          if (child.visible && !referenced.has(child.id)) drawClip(content, child, nested);
        }
        if (intermediate && source.clipPathId) {
          const nestedClip = byId.get(source.clipPathId);
          if (!nestedClip) throw new Error('중첩 클리핑 경로를 찾을 수 없습니다.');
          const nestedRelative = multiplyMatrices(invertMatrix(vectorWorldMatrix(vector, source.id)), vectorWorldMatrix(vector, nestedClip.id));
          intersectAlpha(content, clipMask(nestedClip, drawing.getTransform(), nestedRelative, nested));
          drawing.save(); drawing.resetTransform(); drawing.drawImage(intermediate, 0, 0); drawing.restore();
          intermediate.width = intermediate.height = 0;
        }
        drawing.restore();
      };
      drawClip(target, object, active, relative);
      return surface;
    }

    function renderObject(target: CanvasRenderingContext2D, object: VectorObject, active: Set<string>, reference = false): void {
      if ((!object.visible && !reference) || object.opacity <= 0) return;
      if (active.has(object.id)) throw new Error('순환 벡터 그룹은 렌더링할 수 없습니다.');
      active = new Set(active).add(object.id);
      target.save();
      target.transform(...object.transform);
      const matrix = target.getTransform();
      if (Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-14) { target.restore(); return; }
      const isolated = object.opacity < 1 || !!object.maskId || !!object.clipPathId;
      let drawing = target;
      let isolatedSurface: HTMLCanvasElement | undefined;
      if (isolated) {
        isolatedSurface = canvas(width, height);
        drawing = context(isolatedSurface);
        drawing.setTransform(target.getTransform());
      } else target.globalAlpha *= object.opacity;

      if (object.type === 'group') {
        for (const child of children.get(object.id) ?? []) if (!referenced.has(child.id)) renderObject(drawing, child, active);
      } else {
        const outline = textOutlines.get(object.id);
        const bounds = outline ? getPathBounds(outline) : objectBounds(drawing, object);
        drawing.lineWidth = object.stroke.width;
        drawing.lineCap = object.stroke.lineCap;
        drawing.lineJoin = object.stroke.lineJoin;
        drawing.miterLimit = object.stroke.miterLimit;
        drawing.setLineDash(object.stroke.dash);
        drawing.lineDashOffset = object.stroke.dashOffset;
        if (object.type === 'path' && object.geometry) {
          const path = vectorPath2D(object.geometry);
          paintShape(drawing, object.fill, bounds, false, target => target.fill(path, object.geometry!.fillRule));
          if (object.stroke.width > 0) paintShape(drawing, object.stroke.paint, bounds, true, target => target.stroke(path));
        } else if (object.type === 'image' && object.image) {
          const image = images.get(object.id);
          if (image) drawing.drawImage(image, 0, 0, object.image.width, object.image.height);
        } else if (object.type === 'text' && object.text) {
          if (outline) {
            const path = vectorPath2D(outline);
            paintShape(drawing, object.fill, bounds, false, target => target.fill(path, outline.fillRule));
            if (object.stroke.width > 0) paintShape(drawing, object.stroke.paint, bounds, true, target => target.stroke(path));
          } else {
            drawing.font = font(object);
            drawing.textBaseline = 'alphabetic';
            drawing.textAlign = 'left';
            for (const line of textLines(drawing, object)) {
              let x = line.x;
              for (const glyph of [...line.text]) {
                const glyphX = x;
                paintShape(drawing, object.fill, bounds, false, target => target.fillText(glyph, glyphX, line.y));
                if (object.stroke.width > 0) paintShape(drawing, object.stroke.paint, bounds, true, target => target.strokeText(glyph, glyphX, line.y));
                x += drawing.measureText(glyph).width + object.text.letterSpacing;
              }
            }
          }
        }
      }
      if (isolatedSurface) {
        if (object.clipPathId) {
          const clip = byId.get(object.clipPathId);
          if (!clip) throw new Error('클리핑 경로를 찾을 수 없습니다.');
          const relative = multiplyMatrices(invertMatrix(vectorWorldMatrix(vector, object.id)), vectorWorldMatrix(vector, clip.id));
          intersectAlpha(drawing, clipMask(clip, target.getTransform(), relative, active));
        }
        if (object.maskId) {
          const mask = byId.get(object.maskId);
          if (!mask) throw new Error('마스크 경로를 찾을 수 없습니다.');
          const maskSurface = canvas(width, height);
          const maskContext = context(maskSurface);
          const relative = multiplyMatrices(invertMatrix(vectorWorldMatrix(vector, object.id)), vectorWorldMatrix(vector, mask.id));
          maskContext.setTransform(target.getTransform());
          maskContext.transform(...relative);
          maskContext.transform(...invertMatrix(mask.transform));
          renderObject(maskContext, mask, active, true);
          intersectAlpha(drawing, maskSurface);
        }
        target.save();
        target.resetTransform();
        target.globalAlpha *= object.opacity;
        target.drawImage(isolatedSurface, 0, 0);
        target.restore();
        isolatedSurface.width = isolatedSurface.height = 0;
      }
      target.restore();
    }

    for (const object of children.get(null) ?? []) if (!referenced.has(object.id)) renderObject(ctx, object, new Set());
    return surface;
  })();
  pending.catch(() => { if (renderCache.get(key)?.pending === pending) forgetRender(key); });
  renderCache.set(key, { pending, pixels: width * height });
  renderPixels += width * height;
  while (renderCache.size > MAX_RENDERS || renderPixels > MAX_CACHED_PIXELS) forgetRender(renderCache.keys().next().value!);
  return pending;
}
