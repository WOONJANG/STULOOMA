import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import type { ProjectDocument } from '../../src/types/project';

const logo = resolve('public/samples/transparent-logo.png');
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '기본 반팔 티셔츠', exact: true })).toBeVisible();
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test.afterEach(async ({ page }, info) => {
  const errors = browserErrors.get(page) ?? [];
  await info.attach('browser-errors.json', { body: JSON.stringify(errors, null, 2), contentType: 'application/json' });
  expect(errors, 'No browser exceptions, failed imports, or WebGL errors').toEqual([]);
});

async function numeric(page: Page, name: string, value: number) {
  const field = page.getByRole('spinbutton', { name, exact: true });
  await field.fill(String(value));
  await field.press('Tab');
  await expect(field).toHaveValue(String(value));
}

async function saveDownload(page: Page, info: TestInfo, fileName: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)', exact: true }).click();
  const download = await pending;
  const path = info.outputPath(fileName);
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const zip = unzipSync(new Uint8Array(await readFile(path)));
  const project = JSON.parse(strFromU8(zip['manifest.json'])) as ProjectDocument;
  return { path, zip, project };
}

async function exportFile(page: Page, info: TestInfo, format: 'PNG' | 'JPG' | 'GLB', name: string, size = 2048) {
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '목업 내보내기' });
  await dialog.getByRole('button', { name: new RegExp(`^${format}`) }).click();
  if (format !== 'GLB') await dialog.getByRole('combobox', { name: '출력 해상도' }).selectOption(String(size));
  if (format === 'PNG') await dialog.getByRole('checkbox', { name: '배경을 투명하게' }).check();
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  const pending = page.waitForEvent('download', { timeout: 60_000 });
  await dialog.getByRole('button', { name: '파일 내보내기' }).click();
  const download = await pending;
  const path = info.outputPath(name);
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  await expect(dialog).toHaveCount(0);
  return path;
}

async function assertPNG(page: Page, bytes: Buffer, size = 2048) {
  const pixels = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    let transparent = 0, visible = 0, colorVariation = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] === 0) transparent++;
      if (rgba[i + 3] > 0) { visible++; if (rgba[i] !== rgba[i + 1] || rgba[i + 1] !== rgba[i + 2]) colorVariation++; }
    }
    return { width: image.width, height: image.height, transparent, visible, colorVariation };
  }, bytes.toString('base64'));
  expect(pixels.width).toBe(size);
  expect(pixels.height).toBe(size);
  expect(pixels.transparent).toBeGreaterThan(100_000);
  expect(pixels.visible).toBeGreaterThan(50_000);
  expect(pixels.colorVariation).toBeGreaterThan(10_000);
  return pixels;
}

test('P0 반팔: PNG front/back editing, undo/redo, orbit, modes, project roundtrip, real transparent 2048 PNG', async ({ page }, info) => {
  // Browser WebGL must really be available; export pixel checks below verify rendered content.
  expect(await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))).toBe(true);
  await page.getByRole('textbox', { name: '프로젝트 이름' }).fill('서울 유니폼 — 김수현');
  await page.getByRole('textbox', { name: '프로젝트 이름' }).press('Tab');
  await page.getByLabel('PNG 파일', { exact: true }).setInputFiles(logo);
  await expect(page.getByRole('spinbutton', { name: '가로 위치', exact: true })).toBeVisible();
  await numeric(page, '가로 위치', 42);
  await numeric(page, '세로 위치', 40);
  await numeric(page, '너비', 40);
  await numeric(page, '높이', 25);
  await numeric(page, '회전', 12);
  await numeric(page, '불투명도', 85);

  const canvas = page.getByLabel('2D 디자인 캔버스', { exact: true });
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThan(150);
  await page.mouse.move(box.x + box.width * .42, box.y + box.height * .4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .52, box.y + box.height * .47, { steps: 6 });
  await page.mouse.up();
  const draggedX = Number(await page.getByRole('spinbutton', { name: '가로 위치', exact: true }).inputValue());
  const draggedY = Number(await page.getByRole('spinbutton', { name: '세로 위치', exact: true }).inputValue());
  expect(draggedX).toBeCloseTo(52, 0);
  expect(draggedY).toBeCloseTo(47, 0);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await page.locator('.layer-name').filter({ hasText: 'transparent-logo.png' }).click();
  await expect(page.getByRole('spinbutton', { name: '가로 위치', exact: true })).toHaveValue('42');
  await page.getByRole('button', { name: '다시 실행 (Ctrl+Shift+Z)', exact: true }).click();
  await page.locator('.layer-name').filter({ hasText: 'transparent-logo.png' }).click();
  await expect(page.getByRole('spinbutton', { name: '가로 위치', exact: true })).toHaveValue(String(draggedX));
  await numeric(page, '가로 위치', 52);
  await numeric(page, '세로 위치', 47);
  // Exercise the visible resize and rotation handles with pointer input, then
  // leave an exact numeric transform for the archive roundtrip comparison.
  await numeric(page, '회전', 0);
  await page.mouse.move(box.x + box.width * .72, box.y + box.height * .595);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .78, box.y + box.height * .635, { steps: 6 });
  await page.mouse.up();
  expect(Number(await page.getByRole('spinbutton', { name: '너비', exact: true }).inputValue())).toBeGreaterThan(40);
  await numeric(page, '너비', 40);
  await numeric(page, '높이', 25);
  const rotateY = .47 - .125 - 48 / 1024;
  await page.mouse.move(box.x + box.width * .52, box.y + box.height * rotateY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .66, box.y + box.height * rotateY, { steps: 6 });
  await page.mouse.up();
  expect(Number(await page.getByRole('spinbutton', { name: '회전', exact: true }).inputValue())).toBeGreaterThan(10);
  await numeric(page, '회전', 12);
  await page.getByRole('button', { name: '색상 #345881', exact: true }).click();
  await expect(page.getByLabel('의류 부위 색상', { exact: true })).toHaveValue('#345881');
  await page.getByRole('combobox', { name: '원단 프리셋' }).selectOption('sport');
  await expect(page.getByLabel('재질 거칠기', { exact: true })).toHaveValue('0.42');

  await page.getByRole('combobox', { name: '편집 부위', exact: true }).selectOption('BACK');
  await page.getByLabel('PNG 파일', { exact: true }).setInputFiles(logo);
  await numeric(page, '가로 위치', 55);
  await numeric(page, '세로 위치', 35);
  await numeric(page, '회전', -20);
  await page.getByRole('button', { name: '텍스트 추가', exact: true }).click();
  const text = page.getByRole('textbox', { name: '텍스트 내용' });
  await text.focus();
  await text.fill('');
  await page.keyboard.insertText('서울 농구 23');
  await text.press('Tab');
  await expect(text).toHaveValue('서울 농구 23');
  // Verify that the bundled Korean font used for canvas artwork really loads.
  // Text insertion exercises Unicode editing, not an operating-system IME.
  const koreanFont = await page.evaluate(async () => {
    const faces = await document.fonts.load('700 100px "Noto Sans KR Variable"', '서울 농구 23');
    await document.fonts.ready;
    return { loaded: faces.length, usable: document.fonts.check('700 100px "Noto Sans KR Variable"', '서울 농구 23') };
  });
  expect(koreanFont.loaded).toBeGreaterThan(0);
  expect(koreanFont.usable).toBe(true);
  await page.getByRole('button', { name: '색상 #ab4250', exact: true }).click();
  await page.getByRole('button', { name: '전문가', exact: true }).click();
  await expect(page.getByLabel('재질 금속성', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '간편', exact: true }).click();
  await expect(text).toHaveValue('서울 농구 23');
  await page.getByRole('button', { name: '3D 목업', exact: true }).click();
  await expect(canvas).toBeHidden();
  await page.getByRole('button', { name: '2D 디자인', exact: true }).click();
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: '분할 보기', exact: true }).click();
  await expect(text).toHaveValue('서울 농구 23');

  for (const name of ['정면', '후면', '좌측', '우측']) await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '카메라 초기화', exact: true }).click();
  const stage = page.locator('.stage-panel canvas');
  const scene = (await stage.boundingBox())!;
  await page.mouse.move(scene.x + scene.width * .55, scene.y + scene.height * .45);
  await page.mouse.down();
  await page.mouse.move(scene.x + scene.width * .8, scene.y + scene.height * .55, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(500); // OrbitControls damping settles before the saved camera comparison.

  const original = await saveDownload(page, info, '서울 유니폼.stulooma');
  expect(original.project.name).toBe('서울 유니폼 — 김수현');
  expect(original.project.layers).toHaveLength(3);
  expect(original.project.layers[0]).toMatchObject({ regionId: 'FRONT', width: .4, height: .25, rotation: 12, opacity: .85 });
  expect(original.project.layers[0].x).toBeCloseTo(.52, 5);
  expect(original.project.layers[0].y).toBeCloseTo(.47, 5);
  expect(original.project.layers[1]).toMatchObject({ regionId: 'BACK', x: .55, y: .35, rotation: -20 });
  expect(original.project.layers[2].text).toBe('서울 농구 23');
  expect(Object.values(original.project.assets)).toHaveLength(2);
  expect(original.project.regions.FRONT).toMatchObject({ color: '#345881', roughness: .42 });
  expect(original.project.regions.BACK.color).toBe('#ab4250');
  expect(original.project.camera.position).not.toEqual([0, 0, 3.8]);
  for (const asset of Object.values(original.project.assets)) expect(original.zip[asset.data]).toEqual(new Uint8Array(await readFile(logo)));

  await page.getByRole('button', { name: '새 프로젝트 (Ctrl+N)', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '프로젝트 이름' })).toHaveValue('새 프로젝트');
  await page.getByLabel('프로젝트 파일', { exact: true }).setInputFiles(original.path);
  await expect(page.getByRole('textbox', { name: '프로젝트 이름' })).toHaveValue(original.project.name);
  const reopened = await saveDownload(page, info, 'roundtrip.stulooma');
  expect(reopened.project.layers).toEqual(original.project.layers);
  expect(reopened.project.assets).toEqual(original.project.assets);
  expect(reopened.project.regions).toEqual(original.project.regions);
  reopened.project.camera.position.forEach((value, i) => expect(value).toBeCloseTo(original.project.camera.position[i], 5));
  reopened.project.camera.target.forEach((value, i) => expect(value).toBeCloseTo(original.project.camera.target[i], 5));

  const png = await exportFile(page, info, 'PNG', 'tee-transparent-2048.png');
  const pixels = await assertPNG(page, await readFile(png));
  await info.attach('png-decoded-pixels.json', { body: JSON.stringify(pixels), contentType: 'application/json' });
  const jpg = await exportFile(page, info, 'JPG', 'tee-1024.jpg', 1024);
  const jpgBytes = await readFile(jpg);
  expect([...jpgBytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  const jpgDimensions = await page.evaluate(async base64 => { const image = new Image(); image.src = `data:image/jpeg;base64,${base64}`; await image.decode(); return [image.width, image.height]; }, jpgBytes.toString('base64'));
  expect(jpgDimensions).toEqual([1024, 1024]);
  await page.screenshot({ path: info.outputPath('tee-complete.png'), fullPage: true });
});

test('P0 농구: front/back artwork and material survive save/open; GLB UV registration persists in library', async ({ page }, info) => {
  await page.getByRole('button', { name: '농구 유니폼 선택', exact: true }).click();
  await expect(page.getByRole('heading', { name: '농구 유니폼', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '프로젝트 이름' }).fill('농구 최종 목업');
  await page.getByRole('textbox', { name: '프로젝트 이름' }).press('Tab');
  await page.getByLabel('PNG 파일', { exact: true }).setInputFiles(logo);
  await numeric(page, '가로 위치', 45);
  await numeric(page, '너비', 35);
  await page.getByRole('button', { name: '색상 #273d36', exact: true }).click();
  await page.getByRole('combobox', { name: '편집 부위', exact: true }).selectOption('BACK');
  await page.getByLabel('PNG 파일', { exact: true }).setInputFiles(logo);
  await numeric(page, '세로 위치', 30);
  await numeric(page, '회전', 25);
  await page.getByRole('button', { name: '색상 #e9bc57', exact: true }).click();
  await page.getByRole('combobox', { name: '원단 프리셋' }).selectOption('sport');
  const saved = await saveDownload(page, info, 'basketball.stulooma');
  expect(saved.project.garment.kind).toBe('basketball');
  expect(saved.project.layers).toHaveLength(2);
  expect(saved.project.regions.BACK).toMatchObject({ color: '#e9bc57', roughness: .42 });
  await page.getByRole('button', { name: '기본 반팔 선택', exact: true }).click();
  await page.getByLabel('프로젝트 파일', { exact: true }).setInputFiles(saved.path);
  await expect(page.getByRole('heading', { name: '농구 유니폼', exact: true })).toBeVisible();
  const reopened = await saveDownload(page, info, 'basketball-roundtrip.stulooma');
  expect(reopened.project.layers).toEqual(saved.project.layers);
  expect(reopened.project.regions).toEqual(saved.project.regions);
  const png = await exportFile(page, info, 'PNG', 'basketball-transparent-1024.png', 1024);
  const pixels = await assertPNG(page, await readFile(png), 1024);
  await info.attach('basketball-png-decoded-pixels.json', { body: JSON.stringify(pixels), contentType: 'application/json' });
  const glb = await exportFile(page, info, 'GLB', 'basketball-edited.glb');
  const bytes = await readFile(glb);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  expect(json.meshes.length).toBeGreaterThan(1);
  expect(json.meshes.every((mesh: { primitives: { attributes: Record<string, number> }[] }) => mesh.primitives.every(primitive => primitive.attributes.TEXCOORD_0 !== undefined))).toBe(true);
  await page.getByLabel('GLB 파일', { exact: true }).setInputFiles(glb);
  const wizard = page.getByRole('dialog', { name: '사용자 모델 등록 · UV 확인 완료' });
  await expect(wizard).toBeVisible();
  await wizard.getByRole('textbox', { name: '사용자 모델 이름' }).fill('서울 사용자 농구');
  expect(await wizard.locator('.mesh-row').count()).toBeGreaterThan(1);
  await wizard.getByRole('button', { name: '라이브러리에 등록하고 편집' }).click();
  await expect(wizard).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '서울 사용자 농구', exact: true })).toBeVisible();
  const custom = await saveDownload(page, info, 'custom-model.stulooma');
  expect(custom.project.garment.kind).toBe('custom');
  expect(Object.values(custom.project.assets)[0].mime).toBe('model/gltf-binary');
  await page.reload();
  const recovery = page.getByRole('dialog', { name: '자동 복구 프로젝트' });
  if (await recovery.isVisible()) await recovery.getByRole('button', { name: '새로 시작', exact: true }).click();
  await page.getByRole('button', { name: '내 모델', exact: true }).click();
  const registered = page.getByRole('button', { name: /서울 사용자 농구.*편집 부위/ });
  await expect(registered).toBeVisible();
  await registered.click();
  await expect(page.getByRole('heading', { name: '서울 사용자 농구', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '편집 부위', exact: true }).selectOption('FRONT');
  await page.getByLabel('PNG 파일', { exact: true }).setInputFiles(logo);
  await numeric(page, '가로 위치', 38);
  await numeric(page, '너비', 31);
  const editedCustom = await saveDownload(page, info, 'custom-with-artwork.stulooma');
  expect(editedCustom.project.layers).toHaveLength(1);
  expect(editedCustom.project.layers[0]).toMatchObject({ regionId: 'FRONT', x: .38, width: .31 });
  const mimeTypes = Object.values(editedCustom.project.assets).map(asset => asset.mime);
  expect(mimeTypes).toContain('model/gltf-binary');
  expect(mimeTypes).toContain('image/png');
  await page.getByRole('button', { name: '새 프로젝트 (Ctrl+N)', exact: true }).click();
  await page.getByLabel('프로젝트 파일', { exact: true }).setInputFiles(editedCustom.path);
  await expect(page.getByRole('heading', { name: '서울 사용자 농구', exact: true })).toBeVisible();
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  const customRoundtrip = await saveDownload(page, info, 'custom-with-artwork-roundtrip.stulooma');
  expect(customRoundtrip.project.layers).toEqual(editedCustom.project.layers);
  expect(customRoundtrip.project.assets).toEqual(editedCustom.project.assets);
  await page.screenshot({ path: info.outputPath('custom-library-persisted.png'), fullPage: true });
});

function withoutUV(bytes: Buffer) {
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.attributes.TEXCOORD_0;
  const text = Buffer.from(JSON.stringify(document));
  const json = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(json);
  const binary = bytes.subarray(20 + jsonLength);
  const result = Buffer.alloc(20 + json.length + binary.length);
  bytes.copy(result, 0, 0, 20); result.writeUInt32LE(result.length, 8); result.writeUInt32LE(json.length, 12);
  json.copy(result, 20); binary.copy(result, 20 + json.length);
  return result;
}

test('P0 malformed project, truncated GLB, and missing-UV GLB are rejected without losing the current project', async ({ page }, info) => {
  await page.getByRole('textbox', { name: '프로젝트 이름' }).fill('보존할 한글 프로젝트');
  await page.getByRole('textbox', { name: '프로젝트 이름' }).press('Tab');
  const badFiles = [
    { label: '프로젝트 파일', name: 'broken.stulooma', mimeType: 'application/zip', buffer: Buffer.from('not a ZIP archive'), expected: /ZIP|프로젝트 파일/ },
    { label: 'GLB 파일', name: 'truncated.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from([0x67, 0x6c, 0x54, 0x46, 2]), expected: /GLB.*truncated/i },
    { label: 'GLB 파일', name: 'missing-uv.glb', mimeType: 'model/gltf-binary', buffer: withoutUV(await readFile(resolve('public/models/tshirt.glb'))), expected: /UV|TEXCOORD_0/i },
  ];
  for (const file of badFiles) {
    await page.getByLabel(file.label, { exact: true }).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
    const error = page.getByRole('dialog', { name: '작업을 완료하지 못했습니다' });
    await expect(error).toBeVisible();
    await expect(error.getByRole('alert')).toContainText(file.expected);
    await page.screenshot({ path: info.outputPath(`${file.name}-rejected.png`) });
    await error.getByRole('button', { name: '확인', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '프로젝트 이름' })).toHaveValue('보존할 한글 프로젝트');
    await expect(page.getByRole('heading', { name: '기본 반팔 티셔츠', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: '텍스트 추가', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '텍스트 내용' })).toHaveValue('STULOOMA');
});
