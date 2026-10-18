import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import type { ProjectDocument } from '../../src/types/project';

const browserErrors = new WeakMap<Page, string[]>();
const vector = (page: Page) => page.getByTestId('vector-studio');
const paths = (page: Page) => page.getByTestId('vector-canvas').locator('path[data-vector-object]');

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
});
test.afterEach(async ({ page }, info) => {
  const errors = browserErrors.get(page) ?? [];
  await info.attach('vector-browser-errors.json', { body: JSON.stringify(errors), contentType: 'application/json' });
  expect(errors, 'Vector workflows must not throw browser errors').toEqual([]);
});
async function openVector(page: Page) {
  await page.getByRole('button', { name: 'Vector Studio', exact: true }).click();
  await expect(page.getByTestId('vector-canvas')).toBeVisible();
  await expect(vector(page).getByRole('button', { name: '사각형 도구', exact: true })).toBeVisible();
}
async function artboardPoint(page: Page, x: number, y: number) {
  const box = await page.getByTestId('vector-canvas').locator('.vector-artboard-paper').boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width * x, y: box!.y + box!.height * y };
}
async function drawShape(page: Page, name: string, from: [number, number], to: [number, number]) {
  await vector(page).getByRole('button', { name: `${name} 도구`, exact: true }).click();
  const start = await artboardPoint(page, ...from), end = await artboardPoint(page, ...to);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
}
async function saveProject(page: Page, info: TestInfo, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)', exact: true }).click();
  const download = await pending; const path = info.outputPath(name); await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const zip = unzipSync(new Uint8Array(await readFile(path)));
  return { path, zip, project: JSON.parse(strFromU8(zip['manifest.json'])) as ProjectDocument };
}
async function exportVector(page: Page, info: TestInfo, kind: 'SVG' | 'PNG', name: string) {
  const pending = page.waitForEvent('download');
  if (kind === 'SVG') await vector(page).getByTitle('SVG 내보내기', { exact: true }).click();
  else await vector(page).getByRole('button', { name: 'PNG', exact: true }).click();
  const download = await pending; const path = info.outputPath(name); await download.saveAs(path);
  expect(await download.failure()).toBeNull(); return path;
}
async function samplePNG(page: Page, bytes: Buffer, positions: [number, number][]) {
  return page.evaluate(async ({ encoded, positions }) => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, pixels: positions.map(([x, y]) => [...context.getImageData(Math.floor(x * image.width), Math.floor(y * image.height), 1, 1).data]) };
  }, { encoded: bytes.toString('base64'), positions });
}

test('Vector P0: draw real Boolean geometry, edit an anchor, bind to 3D and preserve editable source plus original PNG through project/SVG round-trip', async ({ page }, info) => {
  const logo = resolve('public/samples/transparent-logo.png');
  await page.getByLabel('PNG 파일', { exact: true }).setInputFiles(logo);
  await openVector(page);
  await drawShape(page, '사각형', [.18, .18], [.78, .78]);
  await drawShape(page, '타원', [.4, .32], [.9, .82]);
  await expect(paths(page)).toHaveCount(2);
  await page.getByTestId('vector-canvas').focus(); await page.keyboard.press('Control+a');
  await vector(page).getByRole('button', { name: '앞면 빼기', exact: true }).click();
  await expect(paths(page)).toHaveCount(1);
  const booleanPath = await paths(page).getAttribute('d');
  expect(booleanPath).toMatch(/^M/); expect(booleanPath!.length).toBeGreaterThan(100);
  await vector(page).getByRole('button', { name: '직접 선택 도구', exact: true }).click();
  const anchor = page.getByTestId('vector-canvas').locator('rect[data-anchor-object]').first();
  const box = (await anchor.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, { steps: 5 }); await page.mouse.up();
  await expect(paths(page)).not.toHaveAttribute('d', booleanPath!);
  const movedPath = await paths(page).getAttribute('d');
  await page.keyboard.press('Control+z'); await expect(paths(page)).toHaveAttribute('d', booleanPath!);
  await page.keyboard.press('Control+Shift+z'); await expect(paths(page)).toHaveAttribute('d', movedPath!);
  await vector(page).getByLabel('벡터 칠 색상', { exact: true }).fill('#d93662');
  await vector(page).getByRole('button', { name: '현재 아트보드 적용', exact: true }).click();
  await vector(page).getByLabel('의류 벡터 width', { exact: true }).fill('62');
  await vector(page).getByLabel('의류 벡터 x', { exact: true }).fill('48');
  await page.getByTestId('vector-canvas').focus();
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  const original = await saveProject(page, info, 'vector-editable.stulooma');
  expect(original.project.version).toBe(2);
  const documents = Object.values(original.project.vectorDocuments ?? {}); expect(documents).toHaveLength(1);
  expect(documents[0].objects).toHaveLength(1);
  expect(documents[0].objects[0].geometry!.contours[0].anchors.length).toBeGreaterThan(8);
  const binding = original.project.layers.find(layer => layer.type === 'vector')!;
  expect(binding).toMatchObject({ regionId: 'FRONT', width: .62, x: .48, vectorDocumentId: documents[0].id });
  const pngAsset = Object.values(original.project.assets).find(asset => asset.mime === 'image/png')!;
  expect(original.zip[pngAsset.data]).toEqual(new Uint8Array(await readFile(logo)));
  const svg = await exportVector(page, info, 'SVG', 'editable.svg');
  const source = await readFile(svg, 'utf8'); expect(source).toContain('<path'); expect(source).not.toContain('<image');
  await page.getByRole('button', { name: '새 프로젝트 (Ctrl+N)', exact: true }).click();
  await page.getByLabel('프로젝트 파일', { exact: true }).setInputFiles(original.path);
  await expect(paths(page)).toHaveAttribute('d', movedPath!);
  const reopened = await saveProject(page, info, 'vector-reopened.stulooma');
  expect(reopened.project.vectorDocuments).toEqual(original.project.vectorDocuments);
  expect(reopened.project.layers).toEqual(original.project.layers);
  expect(reopened.zip[pngAsset.data]).toEqual(original.zip[pngAsset.data]);
  await vector(page).getByLabel('벡터 SVG 가져오기', { exact: true }).setInputFiles(svg);
  await expect(paths(page)).toHaveCount(1);
  await vector(page).getByRole('button', { name: '직접 선택 도구', exact: true }).click();
  await page.getByTestId('vector-canvas').focus(); await page.keyboard.press('Control+a');
  await expect(page.getByTestId('vector-canvas').locator('rect[data-anchor-object]')).not.toHaveCount(0);
  await page.screenshot({ path: info.outputPath('vector-boolean-3d-roundtrip.png'), fullPage: true });
});

test('Vector P0: pen drag creates real cubic handles; direct editing, add-point, grouped undo and zoom preserve geometry', async ({ page }, info) => {
  await openVector(page);
  await vector(page).getByRole('button', { name: '펜 도구', exact: true }).click();
  const a = await artboardPoint(page, .2, .3), h = await artboardPoint(page, .35, .2);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(h.x, h.y, { steps: 5 }); await page.mouse.up();
  const b = await artboardPoint(page, .7, .35), c = await artboardPoint(page, .55, .75);
  await page.mouse.click(b.x, b.y); await page.mouse.click(c.x, c.y); await page.mouse.click(a.x, a.y);
  await expect(paths(page)).toHaveCount(1); const original = await paths(page).getAttribute('d');
  expect(original).toContain('C'); expect(original).toMatch(/Z$/);
  await vector(page).getByRole('button', { name: '직접 선택 도구', exact: true }).click();
  const handle = page.getByTestId('vector-canvas').locator('circle[data-handle="out"]').first();
  const position = (await handle.boundingBox())!;
  await page.mouse.move(position.x + position.width / 2, position.y + position.height / 2); await page.mouse.down();
  await page.mouse.move(position.x + 18, position.y + 12, { steps: 6 }); await page.mouse.up();
  const changed = await paths(page).getAttribute('d'); expect(changed).not.toBe(original);
  await page.keyboard.press('Control+z'); await expect(paths(page)).toHaveAttribute('d', original!);
  await page.keyboard.press('Control+Shift+z'); await expect(paths(page)).toHaveAttribute('d', changed!);
  const point = page.getByTestId('vector-canvas').locator('rect[data-anchor-object]').first(); await point.click();
  const count = await page.getByTestId('vector-canvas').locator('rect[data-anchor-object]').count();
  await vector(page).getByRole('button', { name: '점 추가', exact: true }).click();
  await expect(page.getByTestId('vector-canvas').locator('rect[data-anchor-object]')).toHaveCount(count + 1);
  const beforeZoom = await paths(page).getAttribute('d');
  await vector(page).getByRole('button', { name: '벡터 확대', exact: true }).click();
  await vector(page).getByRole('button', { name: '벡터 확대', exact: true }).click();
  await expect(paths(page)).toHaveAttribute('d', beforeZoom!);
  await vector(page).getByRole('button', { name: '벡터 화면에 맞춤', exact: true }).click();
  await page.screenshot({ path: info.outputPath('vector-pen-handles.png'), fullPage: true });
});

test('Vector P0/P1: editable compound holes, gradient and clipping produce real transparent PNG and update the same 3D binding', async ({ page }, info) => {
  await openVector(page);
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><defs><linearGradient id="paint"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient><clipPath id="clip"><rect x="220" y="40" width="150" height="180"/></clipPath></defs><path id="ring" d="M20 20H180V280H20Z M60 70H140V230H60Z" fill="#22aa66" fill-rule="evenodd"/><g clip-path="url(#clip)"><rect x="200" y="20" width="190" height="260" fill="url(#paint)"/></g></svg>';
  await vector(page).getByLabel('벡터 SVG 가져오기', { exact: true }).setInputFiles({ name: 'compound-gradient-clip.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(source) });
  await expect(paths(page)).toHaveCount(2);
  await vector(page).getByRole('button', { name: '현재 아트보드 적용', exact: true }).click();
  const output = await exportVector(page, info, 'PNG', 'compound-gradient-clip.png');
  const pixels = await samplePNG(page, await readFile(output), [[.1,.5],[.25,.5],[.54,.5],[.6,.5],[.88,.5],[.98,.5]]);
  expect([pixels.width, pixels.height]).toEqual([400,300]);
  expect(pixels.pixels[0]).toEqual([34,170,102,255]); expect(pixels.pixels[1][3]).toBe(0);
  expect(pixels.pixels[2][3]).toBe(0); expect(pixels.pixels[3][3]).toBe(255);
  expect(pixels.pixels[3][0]).toBeGreaterThan(pixels.pixels[4][0]); expect(pixels.pixels[3][2]).toBeLessThan(pixels.pixels[4][2]);
  expect(pixels.pixels[5][3]).toBe(0);
  await info.attach('vector-export-pixels.json', { body: JSON.stringify(pixels), contentType: 'application/json' });
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  const before = await page.locator('.stage-panel canvas').screenshot();
  await vector(page).locator('.vector-layer-name').filter({ hasText: 'ring' }).click();
  await vector(page).getByLabel('벡터 칠 색상', { exact: true }).fill('#cc3333');
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  await expect.poll(async () => (await page.locator('.stage-panel canvas').screenshot()).equals(before)).toBe(false);
  const saved = await saveProject(page, info, 'compound-live.stulooma');
  expect(saved.project.layers.filter(layer => layer.type === 'vector')).toHaveLength(1);
  const binding = saved.project.layers.find(layer => layer.type === 'vector')!;
  expect(binding).toMatchObject({ x: .5, y: .5, rotation: 0, regionId: 'FRONT' });
  const doc = Object.values(saved.project.vectorDocuments!)[0];
  expect(doc.objects.find(object => object.name === 'ring')!.geometry!.contours).toHaveLength(2);
  expect(doc.objects.some(object => object.clipPathId)).toBe(true);
  await page.screenshot({ path: info.outputPath('vector-compound-live-3d.png'), fullPage: true });
});

test('Vector security: active, external and malformed SVG never executes or replaces editable artwork', async ({ page }, info) => {
  await openVector(page); await drawShape(page, '사각형', [.2,.2], [.7,.7]);
  const original = await paths(page).getAttribute('d');
  const external: string[] = []; page.on('request', request => { if (request.url().includes('example.invalid')) external.push(request.url()); });
  for (const name of ['11-external-image.svg','12-malformed.svg','13-dangerous.svg']) {
    await vector(page).getByLabel('벡터 SVG 가져오기', { exact: true }).setInputFiles(resolve('samples/vector', name));
    const error = page.getByRole('dialog', { name: '작업을 완료하지 못했습니다' }); await expect(error).toBeVisible();
    await expect(error.getByRole('alert')).not.toBeEmpty(); await error.getByRole('button', { name: '확인', exact: true }).click();
    await expect(paths(page)).toHaveCount(1); await expect(paths(page)).toHaveAttribute('d', original!);
    expect(await page.evaluate(() => (window as Window & { __stuloomaSvgExecuted?: boolean }).__stuloomaSvgExecuted)).toBeUndefined();
  }
  expect(external).toEqual([]);
  const saved = await saveProject(page, info, 'security-preserved.stulooma');
  expect(Object.values(saved.project.vectorDocuments!)).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('vector-unsafe-preserved.png'), fullPage: true });
});

test('Vector P1: Korean text input keeps editing shortcuts local and converts licensed glyphs into editable contours with undo and saved source', async ({ page }, info) => {
  await openVector(page);
  await vector(page).getByRole('button', { name: '문자 도구', exact: true }).click();
  const position = await artboardPoint(page, .12, .4); await page.mouse.click(position.x, position.y);
  const text = vector(page).getByRole('textbox', { name: '벡터 문자 내용', exact: true });
  const korean = '정관장 · 서울 삼성 썬더스 · 변준형 · 유니폼 디자인 · STULOOMA';
  await text.fill(korean); await expect(text).toHaveValue(korean);
  await text.press('Control+a'); await page.keyboard.insertText('OABP 정관장 23');
  await expect(text).toHaveValue('OABP 정관장 23');
  await expect(vector(page).getByRole('button', { name: '선택 도구', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await vector(page).getByLabel('벡터 문자 크기', { exact: true }).fill('70');
  await vector(page).getByLabel('벡터 문자 자간', { exact: true }).fill('2');
  await vector(page).getByRole('button', { name: '문자 윤곽선 만들기', exact: true }).click();
  await expect(paths(page)).toHaveCount(1);
  await expect(text).toHaveCount(0);
  expect(await paths(page).getAttribute('d')).toContain('C');
  const outlined = await saveProject(page, info, 'korean-glyph-outlines.stulooma');
  const document = Object.values(outlined.project.vectorDocuments!)[0];
  expect(document.objects).toHaveLength(1);
  expect(document.objects[0].type).toBe('path');
  expect(document.objects[0].geometry!.contours.length).toBeGreaterThan(12);
  expect(document.objects[0].geometry!.contours.every(contour => contour.closed)).toBe(true);
  await page.getByTestId('vector-canvas').focus(); await page.keyboard.press('Control+z');
  await expect(text).toHaveValue('OABP 정관장 23');
  await page.getByTestId('vector-canvas').focus(); await page.keyboard.press('Control+Shift+z');
  await expect(paths(page)).toHaveCount(1);
  const svg = await exportVector(page, info, 'SVG', 'outlined-korean.svg');
  const source = await readFile(svg, 'utf8');
  expect(source).toContain('<path'); expect(source).not.toContain('<text'); expect(source).not.toContain('<image');
  await vector(page).getByRole('button', { name: '직접 선택 도구', exact: true }).click();
  await expect(page.getByTestId('vector-canvas').locator('rect[data-anchor-object]')).not.toHaveCount(0);
  await page.screenshot({ path: info.outputPath('vector-korean-glyph-outlines.png'), fullPage: true });
});

test('Vector P1: imported PNG stays byte-exact inside an editable clipping mask through project reopen and clip release', async ({ page }, info) => {
  const originalPNG = await readFile(resolve('public/samples/transparent-logo.png'));
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><clipPath id="window"><circle cx="200" cy="150" r="65"/></clipPath></defs><image id="photo" width="400" height="300" preserveAspectRatio="none" href="data:image/png;base64,${originalPNG.toString('base64')}" clip-path="url(#window)"/></svg>`;
  await openVector(page);
  await vector(page).getByLabel('벡터 SVG 가져오기', { exact: true }).setInputFiles({ name: 'original-png-clip.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(source) });
  await expect(page.getByTestId('vector-canvas').locator('image[data-vector-object]')).toHaveCount(1);
  await vector(page).getByRole('button', { name: '현재 아트보드 적용', exact: true }).click();
  const clippedPNG = await exportVector(page, info, 'PNG', 'original-png-clipped.png');
  const clipped = await samplePNG(page, await readFile(clippedPNG), [[.05,.05],[.5,.5],[.95,.95]]);
  expect(clipped.pixels[0][3]).toBe(0); expect(clipped.pixels[2][3]).toBe(0);
  const saved = await saveProject(page, info, 'png-mask-editable.stulooma');
  const document = Object.values(saved.project.vectorDocuments!)[0];
  const image = document.objects.find(object => object.image)!;
  expect(image.clipPathId).toBeTruthy();
  const asset = saved.project.assets[image.image!.assetId]; expect(saved.zip[asset.data]).toEqual(new Uint8Array(originalPNG));
  await page.getByRole('button', { name: '새 프로젝트 (Ctrl+N)', exact: true }).click();
  await page.getByLabel('프로젝트 파일', { exact: true }).setInputFiles(saved.path);
  await expect(page.getByTestId('vector-canvas').locator('image[data-vector-object]')).toHaveCount(1);
  await vector(page).locator('.vector-layer-name').filter({ hasText: 'photo' }).click();
  await vector(page).getByRole('button', { name: '개체', exact: true }).click();
  await vector(page).getByRole('menuitem', { name: '클리핑 마스크 해제', exact: true }).click();
  const released = await saveProject(page, info, 'png-mask-released.stulooma');
  const releasedDocument = Object.values(released.project.vectorDocuments!)[0];
  const releasedImage = releasedDocument.objects.find(object => object.image)!;
  expect(releasedImage.clipPathId).toBeUndefined();
  expect(releasedImage.image).toEqual(image.image);
  expect(released.zip[asset.data]).toEqual(new Uint8Array(originalPNG));
  await page.screenshot({ path: info.outputPath('vector-original-image-clip-released.png'), fullPage: true });
});
