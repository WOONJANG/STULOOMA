import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // A real same-origin browser canvas without coupling the core tests to app startup.
  await page.route('**/__vector-render-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Vector render verification</title>' }));
  await page.goto('/__vector-render-harness');
});

test('actual canvas preserves cubic edges, compound holes, transformed paints, clips and group opacity', async ({ page }) => {
  const pixels = await page.evaluate(async () => {
    const renderModule = '/src/core/vector/render.ts';
    const geometryModule = '/src/core/vector/geometry.ts';
    const { renderVectorDocument } = await import(/* @vite-ignore */ renderModule);
    const { rectanglePath, parsePathData, createCompoundPath } = await import(/* @vite-ignore */ geometryModule);
    const none = { type: 'none' };
    const solid = (color: string) => ({ type: 'solid', color, opacity: 1 });
    const object = (id: string, geometry: unknown, extra: Record<string, unknown> = {}) => ({
      id, name: id, type: 'path', parentId: null, artboardId: 'board', transform: [1, 0, 0, 1, 0, 0],
      opacity: 1, visible: true, locked: false, fill: solid('#ff0000'),
      stroke: { paint: none, width: 0, lineCap: 'butt', lineJoin: 'miter', miterLimit: 4, dash: [], dashOffset: 0 },
      geometry, ...extra,
    });
    const draw = async (objects: unknown[], name: string) => renderVectorDocument({
      id: name, name, version: 1, assets: [], objects,
      artboards: [{ id: 'board', name: 'Board', x: 0, y: 0, width: 200, height: 200, unit: 'px', background: null }],
    }, 'board', {}, 200, 200);
    const pixel = (canvas: HTMLCanvasElement, x: number, y: number) => [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
    const hole = await draw([object('hole', createCompoundPath([rectanglePath(0, 0, 150, 150), rectanglePath(40, 40, 70, 70)], 'evenodd'))], 'hole');
    const cubic = await draw([object('curve', parsePathData('M0 100 C0 0 100 0 100 100 Z'))], 'cubic');
    const linear = await draw([object('linear', rectanglePath(0, 0, 200, 100), { fill: {
      type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, units: 'objectBoundingBox', transform: [1, 0, 0, 1, .25, 0],
      stops: [{ offset: 0, color: '#ff0000', opacity: 1 }, { offset: 1, color: '#0000ff', opacity: 1 }],
    } })], 'linear');
    const radial = await draw([object('radial', rectanglePath(0, 0, 200, 100), { fill: {
      type: 'radial', cx: .5, cy: .5, fx: .5, fy: .5, r: .5, units: 'objectBoundingBox', transform: [1, 0, 0, 1, 0, 0],
      stops: [{ offset: 0, color: '#ff0000', opacity: 1 }, { offset: 1, color: '#0000ff', opacity: 1 }],
    } })], 'radial');
    const clipped = await draw([object('clip', rectanglePath(0, 0, 50, 100)), object('shape', rectanglePath(0, 0, 150, 100), { clipPathId: 'clip' })], 'clip');
    const transformedClip = await draw([
      object('clip', rectanglePath(0, 0, 75, 100), { transform: [1, 0, 0, 1, 25, 0] }),
      object('shape', rectanglePath(0, 0, 150, 100), { transform: [1, 0, 0, 1, 50, 0], clipPathId: 'clip' }),
    ], 'transformed-clip');
    const mixedClip = await draw([
      object('clipGroup', undefined, { type: 'group', transform: [1, 0, 0, 1, 10, 0] }),
      object('counter', createCompoundPath([rectanglePath(0, 0, 150, 150), rectanglePath(40, 40, 70, 70)], 'evenodd'), { parentId: 'clipGroup' }),
      object('overlap', rectanglePath(60, 0, 30, 150), { parentId: 'clipGroup' }),
      object('shape', rectanglePath(0, 0, 180, 180), { transform: [1, 0, 0, 1, 20, 0], clipPathId: 'clipGroup' }),
    ], 'mixed-clip-rules');
    const masked = await draw([
      object('mask', rectanglePath(0, 0, 75, 100), { transform: [1, 0, 0, 1, 25, 0], opacity: .5, fill: solid('#000000') }),
      object('shape', rectanglePath(0, 0, 150, 100), { transform: [1, 0, 0, 1, 50, 0], maskId: 'mask' }),
    ], 'transformed-mask');
    const group = await draw([
      object('group', undefined, { type: 'group', opacity: .5 }),
      object('first', rectanglePath(0, 0, 100, 100), { parentId: 'group' }),
      object('second', rectanglePath(50, 0, 100, 100), { parentId: 'group' }),
    ], 'group');
    const translucentObject = await draw([object('translucent', rectanglePath(10, 10, 100, 100), { opacity: .5,
      stroke: { paint: solid('#ff0000'), width: 10, lineCap: 'butt', lineJoin: 'miter', miterLimit: 4, dash: [], dashOffset: 0 },
    })], 'translucent-fill-stroke');
    return {
      hole: pixel(hole, 70, 70), holePaint: pixel(hole, 20, 20),
      cubicOutside: pixel(cubic, 50, 20), cubicInside: pixel(cubic, 50, 50),
      linearStart: pixel(linear, 75, 50), linearEnd: pixel(linear, 190, 50),
      radialCenter: pixel(radial, 100, 50), radialHorizontal: pixel(radial, 180, 50), radialVertical: pixel(radial, 100, 90),
      clipInside: pixel(clipped, 20, 20), clipOutside: pixel(clipped, 75, 20),
      transformedInside: pixel(transformedClip, 75, 20), transformedOutside: pixel(transformedClip, 125, 20),
      mixedHole: pixel(mixedClip, 60, 70), mixedUnion: pixel(mixedClip, 85, 70), mixedOverlap: pixel(mixedClip, 85, 20),
      maskInside: pixel(masked, 75, 20), maskOutside: pixel(masked, 125, 20),
      groupSeparate: pixel(group, 20, 20), groupOverlap: pixel(group, 75, 20),
      translucentFill: pixel(translucentObject, 30, 30), translucentFillStroke: pixel(translucentObject, 12, 12),
    };
  });
  expect(pixels.hole[3]).toBe(0);
  expect(pixels.holePaint).toEqual([255, 0, 0, 255]);
  expect(pixels.cubicOutside[3]).toBe(0);
  expect(pixels.cubicInside[3]).toBe(255);
  expect(pixels.linearStart[0]).toBeGreaterThan(210);
  expect(pixels.linearEnd[2]).toBeGreaterThan(170);
  expect(pixels.radialCenter[0]).toBeGreaterThan(245);
  expect(pixels.radialHorizontal[2]).toBeGreaterThan(195);
  expect(Math.abs(pixels.radialHorizontal[2] - pixels.radialVertical[2])).toBeLessThan(5);
  expect(pixels.clipInside[3]).toBe(255);
  expect(pixels.clipOutside[3]).toBe(0);
  expect(pixels.transformedInside[3]).toBe(255);
  expect(pixels.transformedOutside[3]).toBe(0);
  expect(pixels.mixedHole[3]).toBe(0);
  expect(pixels.mixedUnion[3]).toBe(255);
  expect(pixels.mixedOverlap[3]).toBe(255);
  expect(pixels.maskInside[3]).toBeGreaterThanOrEqual(127);
  expect(pixels.maskInside[3]).toBeLessThanOrEqual(128);
  expect(pixels.maskOutside[3]).toBe(0);
  expect(pixels.groupSeparate[3]).toBeGreaterThanOrEqual(127);
  expect(pixels.groupSeparate[3]).toBeLessThanOrEqual(128);
  expect(pixels.groupOverlap[3]).toBe(pixels.groupSeparate[3]);
  expect(pixels.translucentFillStroke[3]).toBe(pixels.translucentFill[3]);
});

test('render cache evicts surfaces when their combined pixel budget exceeds 16 megapixels', async ({ page }) => {
  const values = await page.evaluate(async () => {
    const renderModule = '/src/core/vector/render.ts';
    const { renderVectorDocument, clearVectorRenderCache } = await import(/* @vite-ignore */ renderModule);
    clearVectorRenderCache();
    const doc = { id: 'budget-0', name: 'Budget', version: 1, assets: [], objects: [],
      artboards: [{ id: 'board', name: 'Board', x: 0, y: 0, width: 100, height: 100, unit: 'px', background: null }] };
    const first = await renderVectorDocument(doc, 'board', {}, 2048, 2048);
    for (let index = 1; index <= 4; index++) await renderVectorDocument({ ...doc, id: `budget-${index}` }, 'board', {}, 2048, 2048);
    const newest = await renderVectorDocument({ ...doc, id: 'budget-4' }, 'board', {}, 2048, 2048);
    const newestAgain = await renderVectorDocument({ ...doc, id: 'budget-4' }, 'board', {}, 2048, 2048);
    const firstAgain = await renderVectorDocument(doc, 'board', {}, 2048, 2048);
    clearVectorRenderCache();
    return { evicted: first !== firstAgain, recentRetained: newest === newestAgain };
  });
  expect(values.evicted).toBe(true);
  expect(values.recentRetained).toBe(true);
});

test('mixed garment artwork order and cache respond only to their vector document', async ({ page }) => {
  const values = await page.evaluate(async () => {
    const renderModule = '/src/core/vector/render.ts';
    const geometryModule = '/src/core/vector/geometry.ts';
    const composerModule = '/src/core/textures/composer.ts';
    const projectModule = '/src/core/project/index.ts';
    const { renderVectorDocument } = await import(/* @vite-ignore */ renderModule);
    const { rectanglePath } = await import(/* @vite-ignore */ geometryModule);
    const { composeRegion } = await import(/* @vite-ignore */ composerModule);
    const { createProject } = await import(/* @vite-ignore */ projectModule);
    const source = document.createElement('canvas'); source.width = 2; source.height = 2;
    source.getContext('2d')!.fillStyle = '#0000ff'; source.getContext('2d')!.fillRect(0, 0, 2, 2);
    const project = createProject();
    project.regions.FRONT.color = '#ffffff';
    project.assets.png = { id: 'png', name: 'Blue', mime: 'image/png', data: source.toDataURL() };
    const doc = { id: 'vector', name: 'Vector', version: 1, assets: [],
      artboards: [{ id: 'board', name: 'Board', x: 0, y: 0, width: 100, height: 100, unit: 'px', background: null }],
      objects: [{ id: 'shape', name: 'Shape', type: 'path', parentId: null, artboardId: 'board', transform: [1, 0, 0, 1, 0, 0], opacity: 1, visible: true, locked: false,
        fill: { type: 'solid', color: '#ff0000', opacity: 1 }, geometry: rectanglePath(0, 0, 100, 100),
        stroke: { paint: { type: 'none' }, width: 0, lineCap: 'butt', lineJoin: 'miter', miterLimit: 4, dash: [], dashOffset: 0 } }],
    };
    project.vectorDocuments = { vector: doc };
    const base = { regionId: 'FRONT', x: .5, y: .5, rotation: 0, opacity: 1, visible: true, locked: false };
    project.layers = [
      { ...base, id: 'vectorLayer', name: 'Vector', type: 'vector', vectorDocumentId: 'vector', vectorArtboardId: 'board', width: .8, height: .8 },
      { ...base, id: 'imageLayer', name: 'Image', type: 'image', assetId: 'png', width: .2, height: .2 },
      { ...base, id: 'textLayer', name: 'Text', type: 'text', text: '', color: '#00ff00', width: .2, height: .2 },
    ];
    const pixel = (canvas: HTMLCanvasElement, x: number, y: number) => [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
    const first = await composeRegion(project, 'FRONT', 200);
    const cached = await renderVectorDocument(doc, 'board', project.assets, 160, 160);
    project.updatedAt = 'later';
    project.vectorDocuments.other = { ...doc, id: 'other' };
    const cachedAgain = await renderVectorDocument(doc, 'board', project.assets, 160, 160);
    const changed = structuredClone(doc);
    changed.objects[0].fill.color = '#00ff00';
    project.vectorDocuments.vector = changed;
    const second = await composeRegion(project, 'FRONT', 200);
    project.layers.reverse();
    const reordered = await composeRegion(project, 'FRONT', 200);
    return { vectorPixel: pixel(first, 50, 100), topRaster: pixel(first, 100, 100), cached: cached === cachedAgain,
      editedVector: pixel(second, 50, 100), preservedRaster: pixel(second, 100, 100), reordered: pixel(reordered, 100, 100) };
  });
  expect(values.vectorPixel).toEqual([255, 0, 0, 255]);
  expect(values.topRaster).toEqual([0, 0, 255, 255]);
  expect(values.cached).toBe(true);
  expect(values.editedVector).toEqual([0, 255, 0, 255]);
  expect(values.preservedRaster).toEqual([0, 0, 255, 255]);
  expect(values.reordered).toEqual([0, 255, 0, 255]);
});

test('Korean text and real outlines produce identical transparent pixels', async ({ page }) => {
  const values = await page.evaluate(async () => {
    const renderModule = '/src/core/vector/render.ts';
    const textModule = '/src/core/vector/text.ts';
    const { renderVectorDocument } = await import(/* @vite-ignore */ renderModule);
    const { textToPath, VECTOR_FONT_FAMILY } = await import(/* @vite-ignore */ textModule);
    const text = { content: '옷 OAB', fontFamily: VECTOR_FONT_FAMILY, fontSize: 64, fontWeight: 400, letterSpacing: 2, lineHeight: 1.2, alignment: 'start' };
    const object = { id: 'text', name: 'Text', type: 'text', parentId: null, artboardId: 'board', transform: [1, 0, 0, 1, 10, 90], opacity: 1, visible: true, locked: false,
      fill: { type: 'solid', color: '#102030', opacity: 1 }, stroke: { paint: { type: 'none' }, width: 0, lineCap: 'butt', lineJoin: 'miter', miterLimit: 4, dash: [], dashOffset: 0 }, text };
    const doc = { id: 'text', name: 'Text', version: 1, assets: [], objects: [object],
      artboards: [{ id: 'board', name: 'Board', x: 0, y: 0, width: 300, height: 120, unit: 'px', background: null }] };
    const editable = await renderVectorDocument(doc, 'board', {}, 300, 120);
    const geometry = await textToPath(text);
    const outlined = await renderVectorDocument({ ...doc, id: 'outlined', objects: [{ ...object, type: 'path', text: undefined, geometry }] }, 'board', {}, 300, 120);
    const left = editable.getContext('2d')!.getImageData(0, 0, 300, 120).data;
    const right = outlined.getContext('2d')!.getImageData(0, 0, 300, 120).data;
    let difference = 0, opaque = 0;
    for (let i = 0; i < left.length; i++) { if (left[i] !== right[i]) difference++; if (i % 4 === 3 && left[i] > 128) opaque++; }
    return { difference, opaque, contours: geometry.contours.length, loaded: document.fonts.check('400 64px "STULOOMA Noto Sans KR"', '옷') };
  });
  expect(values.difference).toBe(0);
  expect(values.opaque).toBeGreaterThan(1000);
  expect(values.contours).toBeGreaterThan(8);
  expect(values.loaded).toBe(true);
});
