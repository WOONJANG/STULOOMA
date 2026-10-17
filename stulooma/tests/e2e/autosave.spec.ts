import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dataUrlToBytes, loadProject } from '../../src/core/project';

test('actual local IndexedDB autosave restores Korean front/back artwork after reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  const name = page.getByRole('textbox', { name: '프로젝트 이름', exact: true });
  await name.fill('자동 복구 — 서울 김수현'); await name.press('Tab');
  const logo = resolve('samples/artwork/transparent-logo.png');
  await page.getByLabel('PNG 파일', { exact: true }).setInputFiles(logo);
  const x = page.getByRole('spinbutton', { name: '가로 위치', exact: true });
  await x.fill('37'); await x.press('Tab');
  await page.getByRole('combobox', { name: '편집 부위', exact: true }).selectOption('BACK');
  await page.getByRole('button', { name: '텍스트 추가', exact: true }).click();
  const text = page.getByRole('textbox', { name: '텍스트 내용', exact: true });
  await text.fill('김수현 23'); await text.press('Tab');
  await expect(page.getByText('자동 복구 저장됨', { exact: true })).toBeVisible();

  // Inspect the actual persisted archive through IndexedDB, before reloading.
  const readSaved = () => page.evaluate(async () => {
    const open = indexedDB.open('stulooma-local-v1', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try {
      const request = db.transaction('data').objectStore('data').get('recovery');
      const data = await new Promise<Uint8Array>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return data ? Array.from(data) : [];
    } finally { db.close(); }
  });
  // The status may still describe a previous debounce. Wait for the latest
  // Korean edit in the persisted bytes, rather than a stale success label.
  await expect.poll(async () => {
    const saved = await readSaved();
    return saved.length ? (await loadProject(new Uint8Array(saved))).layers.at(-1)?.text : null;
  }).toBe('김수현 23');
  const before = await loadProject(new Uint8Array(await readSaved()));
  expect(before.layers).toHaveLength(2);
  expect(before.layers[0]).toMatchObject({ regionId: 'FRONT', x: 0.37 });
  expect(before.layers[1]).toMatchObject({ regionId: 'BACK', text: '김수현 23' });

  await page.reload();
  const recovery = page.getByRole('dialog', { name: '자동 복구 프로젝트', exact: true });
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: '복구하기', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  await expect(name).toHaveValue('자동 복구 — 서울 김수현');
  await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('combobox', { name: '편집 부위', exact: true }).selectOption('BACK');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)', exact: true }).click();
  const download = await pending, destination = info.outputPath('recovered.stulooma');
  await download.saveAs(destination);
  const restored = await loadProject(new Uint8Array(await readFile(destination)));
  expect(restored.name).toBe(before.name);
  expect(restored.layers).toEqual(before.layers);
  expect(restored.assets).toEqual(before.assets);
  expect(dataUrlToBytes(Object.values(restored.assets)[0]!.data, 'image/png')).toEqual(new Uint8Array(await readFile(logo)));
  expect(errors).toEqual([]);
});
