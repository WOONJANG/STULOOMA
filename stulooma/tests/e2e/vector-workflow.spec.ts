import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { loadProject } from '../../src/core/project';
import { vectorWorldMatrix } from '../../src/core/vector/document';
import type { ProjectDocument } from '../../src/types/project';
import type { VectorDocument } from '../../src/types/vector';

const studio = (page: Page) => page.getByTestId('vector-studio');
const paintedPaths = (page: Page) => page.getByTestId('vector-canvas').locator('path[data-vector-object]');
const documentOf = (project: ProjectDocument): VectorDocument => Object.values(project.vectorDocuments ?? {})[0]!;

async function saveProject(page: Page, info: TestInfo, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)', exact: true }).click();
  const download = await pending; const path = info.outputPath(name); await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  return { path, project: await loadProject(new Uint8Array(await readFile(path))) };
}

async function objectMenu(page: Page, name: string | RegExp) {
  await studio(page).getByRole('button', { name: '개체', exact: true }).click();
  await studio(page).getByRole('menuitem', { name, exact: typeof name === 'string' }).click();
}

test('Vector workflow: grouped clipping survives artboard duplication and release, and the back binding remains editable after reopening', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: 'Vector Studio', exact: true }).click();
  await expect(page.getByTestId('vector-canvas')).toBeVisible();
  await studio(page).getByLabel('벡터 SVG 가져오기', { exact: true }).setInputFiles({
    name: 'grouped-back.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect id="body" x="30" y="40" width="250" height="170" fill="#1267be" transform="translate(12 8)"/><circle id="badge" cx="220" cy="150" r="60" fill="#e8a82b"/><rect id="window" x="80" y="70" width="180" height="160" fill="#000000" transform="translate(15 -5)"/></svg>'),
  });
  await expect(paintedPaths(page)).toHaveCount(3);
  const initial = documentOf((await saveProject(page, info, 'grouped-source.stulooma')).project);

  await studio(page).getByTitle('body', { exact: true }).click();
  await studio(page).getByTitle('badge', { exact: true }).click({ modifiers: ['Shift'] });
  await studio(page).getByRole('button', { name: '벡터 그룹 만들기', exact: true }).click();
  await expect(studio(page).getByTitle('그룹', { exact: true })).toBeVisible();
  await studio(page).getByLabel('벡터 x', { exact: true }).fill('70');
  await studio(page).getByLabel('벡터 y', { exact: true }).fill('55');
  // The top path is the clipping source; move the new artwork group behind it.
  await objectMenu(page, '맨 뒤로');
  await studio(page).getByTitle('window', { exact: true }).click({ modifiers: ['Shift'] });
  await objectMenu(page, /클리핑 마스크 만들기/);
  await expect(studio(page).getByTitle('클리핑 그룹', { exact: true })).toBeVisible();
  await expect(paintedPaths(page)).toHaveCount(2);
  await studio(page).getByLabel('벡터 x', { exact: true }).fill('95');
  await studio(page).getByLabel('벡터 y', { exact: true }).fill('70');
  const clipped = documentOf((await saveProject(page, info, 'grouped-clipped.stulooma')).project);
  const originalClip = clipped.objects.find(object => object.name === '클리핑 그룹')!;
  expect(originalClip.clipPathId).toBe(clipped.objects.find(object => object.name === 'window')!.id);
  expect(originalClip.transform).not.toEqual([1, 0, 0, 1, 0, 0]);
  for (const source of initial.objects) expect(clipped.objects.find(object => object.id === source.id)?.geometry).toEqual(source.geometry);

  await page.getByTestId('vector-canvas').focus(); await page.keyboard.press('Escape');
  await studio(page).getByRole('button', { name: '복제', exact: true }).click();
  await expect(studio(page).getByLabel('활성 아트보드', { exact: true }).locator('option')).toHaveCount(2);
  await expect(paintedPaths(page)).toHaveCount(2);
  await studio(page).getByTitle('클리핑 그룹', { exact: true }).click();
  await objectMenu(page, '클리핑 마스크 해제');
  await expect(paintedPaths(page)).toHaveCount(3);
  const released = documentOf((await saveProject(page, info, 'duplicated-release.stulooma')).project);
  const firstBoard = released.artboards[0]!, copiedBoard = released.artboards[1]!;
  const copiedObjects = released.objects.filter(object => object.artboardId === copiedBoard.id);
  expect(copiedObjects).toHaveLength(clipped.objects.length);
  expect(new Set(released.objects.map(object => object.id)).size).toBe(released.objects.length);
  const duplicatedClip = copiedObjects.find(object => object.name === '클리핑 그룹')!;
  expect(duplicatedClip.clipPathId).toBeUndefined();
  expect(released.objects.find(object => object.id === originalClip.id)?.clipPathId).toBe(originalClip.clipPathId);
  for (const source of clipped.objects) {
    const copied = copiedObjects.find(object => object.name === source.name)!;
    expect(copied.geometry).toEqual(source.geometry); expect(copied.fill).toEqual(source.fill);
    expect(copied.parentId).toBe(source.parentId ? copiedObjects.find(object => object.name === clipped.objects.find(parent => parent.id === source.parentId)!.name)!.id : null);
    const originalWorld = vectorWorldMatrix(clipped, source.id);
    const copiedWorld = vectorWorldMatrix(released, copied.id);
    expect(copiedWorld).toEqual([originalWorld[0], originalWorld[1], originalWorld[2], originalWorld[3], originalWorld[4] + copiedBoard.x - firstBoard.x, originalWorld[5] + copiedBoard.y - firstBoard.y]);
  }

  // Restore the duplicated clip, then bind the duplicate board to a different UV region.
  await page.getByTestId('vector-canvas').focus(); await page.keyboard.press('Control+z');
  await expect(paintedPaths(page)).toHaveCount(2);
  await studio(page).getByLabel('벡터 적용 부위', { exact: true }).selectOption('BACK');
  await studio(page).getByRole('button', { name: '현재 아트보드 적용', exact: true }).click();
  await expect(studio(page).getByRole('button', { name: '뒷판 벡터 연결 해제', exact: true })).toBeVisible();
  await studio(page).getByLabel('의류 벡터 width', { exact: true }).fill('64');
  await studio(page).getByLabel('의류 벡터 x', { exact: true }).fill('45');
  await studio(page).getByLabel('의류 벡터 y', { exact: true }).fill('56');
  await page.getByRole('button', { name: '후면', exact: true }).click();
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  const bound = await saveProject(page, info, 'back-binding.stulooma');
  const binding = bound.project.layers.find(layer => layer.type === 'vector')!;
  expect(bound.project.layers.filter(layer => layer.type === 'vector')).toHaveLength(1);
  expect(binding).toMatchObject({ regionId: 'BACK', vectorArtboardId: copiedBoard.id, x: .45, y: .56, width: .64 });
  const boundDocument = documentOf(bound.project);
  expect(boundDocument.objects.find(object => object.id === duplicatedClip.id)?.clipPathId).toBe(copiedObjects.find(object => object.name === 'window')!.id);

  await page.getByRole('button', { name: '새 프로젝트 (Ctrl+N)', exact: true }).click();
  await page.getByLabel('프로젝트 파일', { exact: true }).setInputFiles(bound.path);
  await studio(page).getByLabel('활성 아트보드', { exact: true }).selectOption(copiedBoard.id);
  await expect(paintedPaths(page)).toHaveCount(2);
  await studio(page).getByLabel('벡터 적용 부위', { exact: true }).selectOption('BACK');
  await studio(page).getByTitle('body', { exact: true }).click();
  await page.getByRole('button', { name: '후면', exact: true }).click();
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  const before = await page.locator('.stage-panel canvas').screenshot();
  await studio(page).getByLabel('벡터 칠 색상', { exact: true }).fill('#dc315e');
  await expect.poll(async () => (await page.locator('.stage-panel canvas').screenshot()).equals(before)).toBe(false);
  await studio(page).getByRole('button', { name: '현재 아트보드 적용', exact: true }).click();
  const edited = (await saveProject(page, info, 'back-binding-edited.stulooma')).project;
  expect(edited.layers.filter(layer => layer.type === 'vector')).toEqual([binding]);
  const editedDocument = documentOf(edited);
  const copiedBody = editedDocument.objects.find(object => object.artboardId === copiedBoard.id && object.name === 'body')!;
  expect(copiedBody.fill).toEqual({ type: 'solid', color: '#dc315e', opacity: 1 });
  expect(editedDocument.objects.find(object => object.artboardId === firstBoard.id && object.name === 'body')?.fill).toEqual(initial.objects.find(object => object.name === 'body')!.fill);
  await page.screenshot({ path: info.outputPath('vector-group-clip-artboard-back.png'), fullPage: true });
  await info.attach('vector-workflow-browser-errors.json', { body: JSON.stringify(errors), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
