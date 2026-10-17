import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadProject } from '../../src/core/project';

const logo = resolve('public/samples/transparent-logo.png');
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  page.on('console', message => { if (message.type() === 'error') messages.push(message.text()); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '기본 반팔 티셔츠', exact: true })).toBeVisible();
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
});

test.afterEach(async ({ page }, info) => {
  const messages = errors.get(page) ?? [];
  await info.attach('workspace-browser-errors.json', { body: JSON.stringify(messages, null, 2), contentType: 'application/json' });
  expect(messages, 'Workspace actions must not cause browser or WebGL errors').toEqual([]);
});

async function palette(page: Page, label: string) {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: '명령 검색', exact: true });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole('combobox', { name: '명령 검색어', exact: true });
  await search.fill(label);
  await expect(dialog.getByRole('option').filter({ hasText: label }).first()).toBeVisible();
  await search.press('Enter');
  await expect(dialog).toHaveCount(0);
}

async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
  await expect.poll(async () => Number(await input.inputValue())).toBeCloseTo(value, 3);
}

async function saved(page: Page, info: TestInfo, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)', exact: true }).click();
  const download = await pending;
  const path = info.outputPath(name);
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  return loadProject(new Uint8Array(await readFile(path)));
}

test('command palette uses keyboard search, restores focus, and leaves native text editing and composition alone', async ({ page }, info) => {
  const trigger = page.getByRole('button', { name: '명령 검색 (Ctrl+K)', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '명령 검색', exact: true });
  const search = dialog.getByRole('combobox', { name: '명령 검색어', exact: true });
  await expect(search).toBeFocused();
  await search.fill('해당하지 않는 명령 9001');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  await search.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await palette(page, '텍스트 추가');
  await expect(page.locator('.layer-row')).toHaveCount(1);
  const text = page.getByRole('textbox', { name: '텍스트 내용', exact: true });
  await text.fill('서울 디자인 23');
  await text.press('Control+d');
  await text.press('ArrowLeft');
  await text.press('Backspace');
  await text.press('Tab');
  // A synthetic composing event checks the application's shortcut guard. It
  // does not claim to exercise an operating-system Korean input method.
  const selected = page.locator('.layer-name').first();
  await selected.focus();
  await selected.dispatchEvent('keydown', { key: 'Delete', code: 'Delete', isComposing: true, keyCode: 229, bubbles: true });
  await selected.dispatchEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true, isComposing: true, keyCode: 229, bubbles: true });
  const position = {
    x: await page.getByRole('spinbutton', { name: '가로 위치', exact: true }).inputValue(),
    y: await page.getByRole('spinbutton', { name: '세로 위치', exact: true }).inputValue(),
  };
  const menubar = page.getByRole('menubar', { name: '프로그램 메뉴', exact: true });
  const fileMenu = menubar.getByRole('menuitem', { name: '파일', exact: true });
  await fileMenu.focus();
  await fileMenu.press('ArrowDown');
  await expect(page.getByRole('menu', { name: '파일', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menu', { name: '편집', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menubar.getByRole('menuitem', { name: '편집', exact: true })).toBeFocused();
  await expect(page.getByRole('spinbutton', { name: '가로 위치', exact: true })).toHaveValue(position.x);
  await expect(page.getByRole('spinbutton', { name: '세로 위치', exact: true })).toHaveValue(position.y);
  const project = await saved(page, info, 'text-shortcut-guards.stulooma');
  expect(project.layers).toHaveLength(1);
  expect(project.layers[0]!.text).toBe(await text.inputValue());
  expect(project.layers[0]!.text).not.toBe('STULOOMA');
});

test('clipboard preserves PNG assets across regions, undo/redo, Korean rename, and locked transforms', async ({ page }, info) => {
  await page.getByLabel('PNG 파일', { exact: true }).setInputFiles(logo);
  await number(page, '가로 위치', 37);
  await number(page, '세로 위치', 40);
  await page.locator('.layer-name').first().click();
  await page.keyboard.press('Control+c');
  await page.getByRole('combobox', { name: '편집 부위', exact: true }).selectOption('BACK');
  // View buttons return focus from the region select to the editor commands.
  await page.getByRole('button', { name: '2D 디자인', exact: true }).click();
  await page.keyboard.press('Control+v');
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: '가로 위치', exact: true }).inputValue())).toBeCloseTo(39.5, 3);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.layer-row')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await page.locator('.layer-name').first().click();
  await page.keyboard.press('F2');
  const rename = page.getByRole('dialog', { name: '레이어 이름 바꾸기', exact: true });
  await rename.getByRole('textbox', { name: '레이어 이름', exact: true }).fill('뒷판 로고 — 서울');
  await rename.getByRole('button', { name: '이름 변경', exact: true }).click();
  await expect(rename).toHaveCount(0);
  await page.getByRole('button', { name: '뒷판 로고 — 서울 잠금', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  const project = await saved(page, info, 'clipboard-locked.stulooma');
  expect(project.layers).toHaveLength(2);
  const front = project.layers.find(layer => layer.regionId === 'FRONT')!;
  const back = project.layers.find(layer => layer.regionId === 'BACK')!;
  expect(front).toMatchObject({ x: .37, y: .4, locked: false });
  expect(back).toMatchObject({ name: '뒷판 로고 — 서울', locked: true });
  expect(back.x).toBeCloseTo(.395, 6);
  expect(back.y).toBeCloseTo(.425, 6);
  expect(back.id).not.toBe(front.id);
  expect(back.assetId).toBe(front.assetId);
  expect(Object.keys(project.assets)).toHaveLength(1);
});

test('2D precision commands, zoom, fit, grid and snapping work with actual pointer editing', async ({ page }, info) => {
  await page.getByRole('button', { name: '텍스트 추가', exact: true }).click();
  await page.locator('.layer-name').first().click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: '가로 위치', exact: true }).inputValue())).toBeCloseTo(50.1, 3);
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: '세로 위치', exact: true }).inputValue())).toBeCloseTo(43, 3);
  await palette(page, '가로 가운데 정렬');
  await palette(page, '세로 가운데 정렬');
  const aligned = await saved(page, info, 'aligned.stulooma');
  expect(aligned.layers[0]).toMatchObject({ x: .5, y: .5 });

  const canvas = page.getByLabel('2D 디자인 캔버스', { exact: true });
  const fitBox = (await canvas.boundingBox())!;
  const zoom = page.getByLabel('2D 확대 비율', { exact: true });
  await expect(zoom).toHaveText('100%');
  await page.getByRole('button', { name: '2D 확대', exact: true }).click();
  await expect(zoom).not.toHaveText('100%');
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(fitBox.width);
  await page.getByRole('button', { name: '2D 화면에 맞춤', exact: true }).click();
  await expect(zoom).toHaveText('100%');
  expect((await canvas.boundingBox())!.width).toBeCloseTo(fitBox.width, 1);

  const grid = page.getByRole('button', { name: '그리드 표시', exact: true });
  const initialGrid = await grid.getAttribute('aria-pressed');
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', initialGrid === 'true' ? 'false' : 'true');
  const snap = page.getByRole('button', { name: '스냅', exact: true });
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await number(page, '가로 위치', 46);
  await number(page, '세로 위치', 42);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .46, box.y + box.height * .42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .495, box.y + box.height * .42, { steps: 5 });
  await page.mouse.up();
  const snapped = await saved(page, info, 'snapped.stulooma');
  expect(snapped.layers[0]!.x).toBeCloseTo(.5, 5);
  await page.keyboard.press('Control+z');
  await page.locator('.layer-name').first().click();
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: '가로 위치', exact: true }).inputValue())).toBeCloseTo(46, 3);
});

test('desktop workspace fits 1366×768 and preserves resized or hidden panels after reload', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const library = page.locator('aside.library');
  const properties = page.locator('aside.properties');
  const separator = page.getByRole('separator', { name: '라이브러리 너비', exact: true });
  const beforeWidth = (await library.boundingBox())!.width;
  const handle = (await separator.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 32, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  const resizedWidth = (await library.boundingBox())!.width;
  expect(resizedWidth).toBeGreaterThan(beforeWidth + 15);
  await page.getByRole('button', { name: '라이브러리 패널 전환', exact: true }).click();
  await page.getByRole('button', { name: '속성 패널 전환', exact: true }).click();
  await expect(library).toBeHidden();
  await expect(properties).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  const recovery = page.getByRole('dialog', { name: '자동 복구 프로젝트', exact: true });
  if (await recovery.isVisible()) await recovery.getByRole('button', { name: '새로 시작', exact: true }).click();
  await expect(library).toBeHidden();
  await expect(properties).toBeHidden();
  await page.getByRole('button', { name: '라이브러리 패널 전환', exact: true }).click();
  await page.getByRole('button', { name: '속성 패널 전환', exact: true }).click();
  expect((await library.boundingBox())!.width).toBeCloseTo(resizedWidth, 0);
  const canvasBox = (await page.getByLabel('2D 디자인 캔버스', { exact: true }).boundingBox())!;
  const editorBox = (await page.locator('.editor-panel').boundingBox())!;
  expect(canvasBox.width).toBeGreaterThan(100);
  expect(canvasBox.width).toBeCloseTo(canvasBox.height, 1);
  expect(canvasBox.y).toBeGreaterThanOrEqual(editorBox.y);
  expect(canvasBox.y + canvasBox.height).toBeLessThanOrEqual(editorBox.y + editorBox.height + 1);
  await expect(page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '내보내기', exact: true })).toBeInViewport();
  const overflow = await page.evaluate(() => {
    const elements = [document.documentElement, document.body, document.querySelector('.studio')!, document.querySelector('.workspace')!];
    return elements.map(element => ({ width: element.scrollWidth - element.clientWidth, height: element.scrollHeight - element.clientHeight }));
  });
  for (const element of overflow) {
    expect(element.width).toBeLessThanOrEqual(1);
    expect(element.height).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath('workspace-1366x768.png'), fullPage: true });
});

test('file drop, history navigation, canvas pan and text scaling preserve real editable data', async ({ page }, info) => {
  const png = await readFile(logo);
  const transfer = await page.evaluateHandle(({ bytes }) => {
    const value = new DataTransfer();
    value.items.add(new File([new Uint8Array(bytes)], 'dropped-logo.png', { type: 'image/png' }));
    return value;
  }, { bytes: [...png] });
  await page.locator('.studio').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await page.getByRole('tab', { name: '편집 기록', exact: true }).click();
  const history = page.getByRole('tabpanel', { name: '편집 기록', exact: true });
  await history.getByRole('button', { name: /시작 상태/ }).click();
  await page.getByRole('tab', { name: '속성 및 레이어', exact: true }).click();
  await expect(page.locator('.layer-row')).toHaveCount(0);
  await page.getByRole('button', { name: '다시 실행 (Ctrl+Shift+Z)', exact: true }).click();
  await expect(page.locator('.layer-row')).toHaveCount(1);

  const canvas = page.getByTestId('design-canvas');
  const initial = (await canvas.boundingBox())!;
  await canvas.focus();
  await page.keyboard.down('Space');
  await page.mouse.move(initial.x + initial.width * .5, initial.y + initial.height * .7);
  await page.mouse.down();
  await page.mouse.move(initial.x + initial.width * .5 + 24, initial.y + initial.height * .7 + 18, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await canvas.boundingBox())!.x).toBeCloseTo(initial.x + 24, 0);
  await page.getByRole('button', { name: '2D 화면에 맞춤', exact: true }).click();
  expect((await canvas.boundingBox())!.x).toBeCloseTo(initial.x, 0);

  await page.getByRole('button', { name: '텍스트 추가', exact: true }).click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .85, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .9, box.y + box.height * .52, { steps: 5 });
  await page.mouse.up();
  const fontSize = page.getByRole('spinbutton', { name: '글자 크기', exact: true });
  await expect.poll(async () => Number(await fontSize.inputValue())).toBeGreaterThan(105);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect(fontSize).toHaveValue('100');
  const text = page.getByRole('textbox', { name: '텍스트 내용', exact: true });
  await text.fill('실행 취소할 한글');
  await text.press('Tab');
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect(text).toHaveValue('STULOOMA');

  await page.locator('.layer-name').first().click();
  await page.keyboard.press('F2');
  const rename = page.getByRole('dialog', { name: '레이어 이름 바꾸기', exact: true });
  const name = rename.getByRole('textbox', { name: '레이어 이름', exact: true });
  await expect(name).toBeFocused();
  await name.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, keyCode: 229, bubbles: true });
  await expect(rename).toBeVisible();
  await name.press('Escape');
  await expect(rename).toHaveCount(0);
  const project = await saved(page, info, 'drop-history-text.stulooma');
  expect(project.layers).toHaveLength(2);
  const imported = Object.values(project.assets).find(asset => asset.name === 'dropped-logo.png')!;
  expect(Buffer.from(imported.data.split(',')[1]!, 'base64')).toEqual(png);
});
