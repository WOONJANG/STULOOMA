import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { createProject, saveProject } from '../../src/core/project';
import { createVectorDocument, createVectorObject, vectorWorldMatrix } from '../../src/core/vector/document';
import { applyMatrix, getPathBounds, rectanglePath } from '../../src/core/vector/geometry';
import type { ProjectDocument } from '../../src/types/project';

const studio = (page: Page) => page.getByTestId('vector-studio');
const canvas = (page: Page) => page.getByTestId('vector-canvas');
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const collected: string[] = []; errors.set(page, collected);
  page.on('pageerror', error => collected.push(error.message));
  page.on('console', message => { if (message.type() === 'error') collected.push(message.text()); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: 'Vector Studio', exact: true }).click();
  await expect(canvas(page)).toBeVisible();
});
test.afterEach(async ({ page }) => expect(errors.get(page) ?? []).toEqual([]));

async function importSource(page: Page, source: string) {
  await studio(page).getByLabel('벡터 SVG 가져오기', { exact: true }).setInputFiles({ name: 'regression.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(source) });
}
async function saved(page: Page, info: TestInfo, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)', exact: true }).click();
  const download = await pending, path = info.outputPath(name); await download.saveAs(path);
  const zip = unzipSync(new Uint8Array(await readFile(path)));
  return JSON.parse(strFromU8(zip['manifest.json'])) as ProjectDocument;
}
async function paperPoint(page: Page, x: number, y: number) {
  const box = await canvas(page).locator('.vector-artboard-paper').boundingBox();
  expect(box).not.toBeNull(); return { x: box!.x + box!.width * x, y: box!.y + box!.height * y };
}

test('locked paths and descendants of a locked group resist direct handles, inspector edits and arrow transforms', async ({ page }, info) => {
  await importSource(page, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><g id="family" transform="translate(30 20)"><path id="child" d="M20 20H180V180H20Z" fill="#33aa77"/></g><path id="independent" d="M230 40H330V140H230Z" fill="#8855cc"/></svg>');
  const child = studio(page).locator('.vector-layer-name').filter({ hasText: 'child' });
  await child.click();
  await studio(page).getByRole('button', { name: '직접 선택 도구', exact: true }).click();
  await expect(canvas(page).locator('[data-anchor-object]')).toHaveCount(4);
  const original = Object.values((await saved(page, info, 'unlocked.stulooma')).vectorDocuments!)[0];

  await studio(page).getByRole('button', { name: 'family 잠금', exact: true }).click();
  await expect(canvas(page).locator('[data-anchor-object]')).toHaveCount(0);
  await child.click();
  await canvas(page).focus(); await page.keyboard.press('ArrowRight');
  await studio(page).getByLabel('벡터 칠 색상', { exact: true }).fill('#ff0000');
  await studio(page).getByLabel('벡터 x', { exact: true }).fill('90');
  const lockedGroup = Object.values((await saved(page, info, 'group-locked.stulooma')).vectorDocuments!)[0];
  const sourceChild = original.objects.find(object => object.name === 'child')!;
  expect(lockedGroup.objects.find(object => object.id === sourceChild.id)).toEqual(sourceChild);
  expect(lockedGroup.artboards).toEqual(original.artboards);

  await studio(page).getByRole('button', { name: 'family 잠금 해제', exact: true }).click();
  await studio(page).getByRole('button', { name: 'child 잠금', exact: true }).click();
  await expect(canvas(page).locator('[data-anchor-object]')).toHaveCount(0);
  await canvas(page).focus(); await page.keyboard.press('ArrowDown');
  await studio(page).getByLabel('벡터 선 두께', { exact: true }).fill('40');
  const lockedPath = Object.values((await saved(page, info, 'path-locked.stulooma')).vectorDocuments!)[0];
  expect(lockedPath.objects.find(object => object.id === sourceChild.id)).toEqual({ ...sourceChild, locked: true });
  expect(lockedPath.artboards).toEqual(original.artboards);

  // Removing a whole earlier contour must not shift the indices of points still
  // scheduled for removal from a later contour of the same editable object.
  await importSource(page, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><path id="compound" d="M20 20H350V350H20Z M100 100H250V250H100Z" fill="#33aa77" fill-rule="evenodd"/></svg>');
  await studio(page).locator('.vector-layer-name').filter({ hasText: 'compound' }).click();
  const outer = canvas(page).locator('rect[data-anchor-object][data-contour="0"]');
  await expect(outer).toHaveCount(4);
  await outer.nth(0).click();
  for (let i = 1; i < 4; i++) await outer.nth(i).click({ modifiers: ['Shift'] });
  await canvas(page).locator('rect[data-anchor-object][data-contour="1"]').first().click({ modifiers: ['Shift'] });
  await studio(page).getByRole('button', { name: '점 제거', exact: true }).click();
  await expect(canvas(page).locator('rect[data-anchor-object]')).toHaveCount(3);
  const removed = Object.values((await saved(page, info, 'compound-anchors-removed.stulooma')).vectorDocuments!).find(document => document.objects.some(object => object.name === 'compound'))!;
  expect(removed.objects.find(object => object.name === 'compound')!.geometry!.contours).toHaveLength(1);
});

test('continuing a translated and scaled open path places new anchors and cubic handles in document coordinates', async ({ page }, info) => {
  await importSource(page, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><g id="parent" transform="translate(60 40) scale(2)"><path id="continue" d="M10 10L50 20" fill="none" stroke="#6633aa" stroke-width="4"/></g></svg>');
  await studio(page).locator('.vector-layer-name').filter({ hasText: 'continue' }).click();
  await studio(page).getByRole('button', { name: '경로', exact: true }).click();
  await studio(page).getByRole('menuitem', { name: '열린 패스 이어 그리기', exact: true }).click();
  const position = await paperPoint(page, .65, .65), handle = await paperPoint(page, .75, .55);
  await page.mouse.move(position.x, position.y); await page.mouse.down();
  await page.mouse.move(handle.x, handle.y, { steps: 5 }); await page.mouse.up();
  await page.keyboard.press('Enter');
  const document = Object.values((await saved(page, info, 'continued-transformed.stulooma')).vectorDocuments!)[0];
  const object = document.objects.find(object => object.name === 'continue')!, anchors = object.geometry!.contours[0].anchors;
  expect(anchors).toHaveLength(3); expect(anchors[0]).toMatchObject({ x: 10, y: 10 }); expect(anchors[1]).toMatchObject({ x: 50, y: 20 });
  const matrix = vectorWorldMatrix(document, object.id), last = anchors.at(-1)!;
  const world = applyMatrix(matrix, last), outgoing = applyMatrix(matrix, last.out!), incoming = applyMatrix(matrix, last.in!);
  expect(world.x).toBeCloseTo(260, 0); expect(world.y).toBeCloseTo(260, 0);
  expect(outgoing.x).toBeCloseTo(300, 0); expect(outgoing.y).toBeCloseTo(220, 0);
  expect(incoming.x).toBeCloseTo(220, 0); expect(incoming.y).toBeCloseTo(300, 0);
  await studio(page).getByRole('button', { name: '직접 선택 도구', exact: true }).click();
  const handles = canvas(page).locator('rect[data-anchor-object]'); await expect(handles).toHaveCount(3);
  const before = await canvas(page).locator('path[data-vector-object]').getAttribute('d');
  await handles.last().click();
  await studio(page).getByRole('button', { name: '점 추가', exact: true }).click();
  await expect(page.getByText('열린 패스의 마지막 점에는 다음 선분이 없습니다. 이전 앵커를 선택하세요.', { exact: true })).toBeVisible();
  await expect(handles).toHaveCount(3);
  await expect(canvas(page).locator('path[data-vector-object]')).toHaveAttribute('d', before!);
  const xInput = studio(page).getByLabel('벡터 x', { exact: true });
  await xInput.focus(); await xInput.press('Control+a'); await xInput.pressSequentially('-12.5');
  await xInput.press('Enter');
  await expect(xInput).toHaveValue('-12.5');
  const positioned = Object.values((await saved(page, info, 'continued-negative-position.stulooma')).vectorDocuments!)[0];
  const positionedObject = positioned.objects.find(item => item.id === object.id)!;
  expect(getPathBounds(positionedObject.geometry!, vectorWorldMatrix(positioned, positionedObject.id)).x).toBeCloseTo(-12.5, 5);
  await canvas(page).focus(); await page.keyboard.press('Control+z');
  expect(Number(await xInput.inputValue())).toBeCloseTo(getPathBounds(object.geometry!, matrix).x, 2);
  await page.keyboard.press('Control+Shift+z');
  await expect(xInput).toHaveValue('-12.5');
});

test('masked artwork copy and artboard duplication remap masks to independent objects on the destination artboard', async ({ page }, info) => {
  const project = createProject(), document = createVectorDocument('Internal alpha mask', 400, 400), board = document.artboards[0];
  const mask = createVectorObject('path', board.id, { name: 'alpha-source', geometry: rectanglePath(60, 60, 180, 180) });
  const target = createVectorObject('path', board.id, { name: 'masked-art', geometry: rectanglePath(20, 20, 260, 260), maskId: mask.id });
  document.objects.push(mask, target); project.version = 2; project.vectorDocuments = { [document.id]: document };
  await page.getByLabel('프로젝트 파일', { exact: true }).setInputFiles({ name: 'alpha-mask.stulooma', mimeType: 'application/octet-stream', buffer: Buffer.from(await saveProject(project)) });
  await studio(page).locator('.vector-layer-name').filter({ hasText: 'masked-art' }).click();
  await canvas(page).focus(); await page.keyboard.press('Control+c');
  await studio(page).getByRole('button', { name: '아트보드 추가', exact: true }).click();
  await canvas(page).focus(); await page.keyboard.press('Control+v');
  const pasted = Object.values((await saved(page, info, 'alpha-pasted.stulooma')).vectorDocuments!)[0];
  const copy = pasted.objects.find(object => object.name === 'masked-art 사본')!;
  expect(copy).toBeTruthy(); expect(copy.maskId).toBeTruthy(); expect(copy.maskId).not.toBe(mask.id);
  expect(pasted.objects.find(object => object.id === copy.maskId)?.artboardId).toBe(copy.artboardId);

  await canvas(page).focus(); await page.keyboard.press('Escape');
  await studio(page).getByRole('button', { name: '복제', exact: true }).click();
  const duplicated = Object.values((await saved(page, info, 'alpha-artboard-duplicated.stulooma')).vectorDocuments!)[0];
  expect(duplicated.artboards).toHaveLength(3);
  const boardCopy = duplicated.artboards[2], targetCopy = duplicated.objects.find(object => object.artboardId === boardCopy.id && object.maskId)!;
  expect(targetCopy).toBeTruthy(); expect(targetCopy.maskId).not.toBe(copy.maskId);
  expect(duplicated.objects.find(object => object.id === targetCopy.maskId)?.artboardId).toBe(boardCopy.id);
});
