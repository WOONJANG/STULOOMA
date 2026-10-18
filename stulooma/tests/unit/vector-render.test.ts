import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VectorDocument, VectorText } from '../../src/types/vector';
import { flattenPath, getPathBounds } from '../../src/core/vector/geometry';
import { vectorDocumentCacheKey } from '../../src/core/vector/render';
import { textToPath, VECTOR_FONT_FAMILY } from '../../src/core/vector/text';

const text = (content: string, patch: Partial<VectorText> = {}): VectorText => ({
  content, fontFamily: VECTOR_FONT_FAMILY, fontSize: 100, fontWeight: 400,
  letterSpacing: 0, lineHeight: 1.2, alignment: 'start', ...patch,
});

describe('real bundled font outlines', () => {
  beforeAll(async () => {
    const bytes = await readFile(new URL('../../public/fonts/NotoSansCJKkr-Regular.otf', import.meta.url));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
  });
  afterAll(() => vi.unstubAllGlobals());

  it('preserves the opposite winding of O counter and real cubic handles', async () => {
    const path = await textToPath(text('O'));
    expect(path.contours).toHaveLength(2);
    expect(path.contours.every(contour => contour.closed)).toBe(true);
    expect(path.contours.some(contour => contour.anchors.some(anchor => anchor.in || anchor.out))).toBe(true);
    const areas = flattenPath(path, .05).map(contour => contour.points.reduce((sum, point, index, points) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0));
    expect(areas[0] * areas[1]).toBeLessThan(0);
    expect(getPathBounds(path).width).toBeGreaterThan(50);
  });

  it('converts Korean glyphs to editable closed contours and keeps letter spacing', async () => {
    const korean = await textToPath(text('옷'));
    expect(korean.contours.length).toBeGreaterThanOrEqual(3);
    expect(korean.contours.every(contour => contour.closed && contour.anchors.length >= 3)).toBe(true);
    expect(getPathBounds(korean).height).toBeGreaterThan(70);
    const normal = getPathBounds(await textToPath(text('OO')));
    const spaced = getPathBounds(await textToPath(text('OO', { letterSpacing: 15 })));
    expect(spaced.width - normal.width).toBeCloseTo(15, 7);
  });

  it('keeps outlines across line breaks/alignment and rejects fake font replacement', async () => {
    const first = getPathBounds(await textToPath(text('O')));
    const second = getPathBounds(await textToPath(text('O\nO', { alignment: 'middle' })));
    expect(second.height - first.height).toBeCloseTo(120, 6);
    expect(second.x).toBeLessThan(first.x);
    await expect(textToPath(text('A', { fontWeight: 700 }))).rejects.toThrow('Regular');
    await expect(textToPath(text('A', { fontFamily: 'Arial' }))).rejects.toThrow('Regular');
    await expect(textToPath(text('🦄'))).rejects.toThrow('없는 문자');
  });
});

it('keys only the target artboard document, referenced image data and output dimensions', () => {
  const document: VectorDocument = {
    id: 'document', name: 'name', version: 1, assets: ['image'],
    artboards: [{ id: 'artboard', name: 'Artboard', x: 0, y: 0, width: 100, height: 100, unit: 'px', background: null }],
    objects: [{ id: 'imageObject', name: 'Image', type: 'image', parentId: null, artboardId: 'artboard',
      transform: [1, 0, 0, 1, 0, 0], opacity: 1, visible: true, locked: false,
      fill: { type: 'none' }, stroke: { paint: { type: 'none' }, width: 0, lineCap: 'butt', lineJoin: 'miter', miterLimit: 4, dash: [], dashOffset: 0 },
      image: { assetId: 'image', width: 100, height: 100 } }],
  };
  const asset = { id: 'image', name: 'test.png', mime: 'image/png' as const, data: 'data:image/png;base64,first' };
  const key = vectorDocumentCacheKey(document, 'artboard', { image: asset });
  expect(vectorDocumentCacheKey({ ...document, name: 'renamed', metadata: { modified: true } }, 'artboard', { image: asset,
    unrelated: { ...asset, id: 'unrelated', data: 'data:image/png;base64,else' } })).toBe(key);
  expect(vectorDocumentCacheKey(document, 'artboard', { image: { ...asset, data: 'data:image/png;base64,changed' } })).not.toBe(key);
  expect(vectorDocumentCacheKey(document, 'artboard', { image: asset }, 2048)).not.toBe(key);
  expect(vectorDocumentCacheKey({ ...document, objects: [{ ...document.objects[0], opacity: .5 }] }, 'artboard', { image: asset })).not.toBe(key);
});
