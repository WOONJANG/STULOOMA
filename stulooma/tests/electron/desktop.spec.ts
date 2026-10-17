import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';

test('desktop uses a restricted bridge, opens and atomically saves native files', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'stulooma-desktop-'));
  let application: ElectronApplication | undefined;
  try {
    const source = path.join(temporary, 'source.stulooma');
    const destination = path.join(temporary, 'saved.stulooma');
    await writeFile(source, 'local project bytes');
    const ciFlags = process.env.STULOOMA_CI_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
    application = await electron.launch({
      executablePath: process.env.STULOOMA_TEST_EXECUTABLE || undefined,
      args: [...(process.env.STULOOMA_TEST_EXECUTABLE ? [] : ['.']), ...ciFlags, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(temporary, 'config'),
        XDG_CACHE_HOME: path.join(temporary, 'cache'),
      },
    });
    const page = await application.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)' })).toBeVisible();
    await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
    expect(page.url()).toBe('app://stulooma/index.html');
    const bridge = await page.evaluate(() => ({
      methods: Object.keys((window as unknown as { stulooma: object }).stulooma).sort(),
      frozen: Object.isFrozen((window as unknown as { stulooma: object }).stulooma),
      node: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(bridge).toEqual({ methods: ['openProject', 'saveFile'], frozen: true, node: 'undefined', process: 'undefined' });

    await application.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.source] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.destination });
    }, { source, destination });
    const opened = await page.evaluate(async () => {
      const bridge = (window as unknown as { stulooma: { openProject: () => Promise<{ name: string; data: Uint8Array }> } }).stulooma;
      const result = await bridge.openProject();
      return { name: result.name, text: new TextDecoder().decode(result.data), keys: Object.keys(result).sort() };
    });
    expect(opened).toEqual({ name: 'source.stulooma', text: 'local project bytes', keys: ['data', 'name'] });
    expect(await page.evaluate(async () => {
      const bridge = (window as unknown as { stulooma: { saveFile: (request: unknown) => Promise<boolean> } }).stulooma;
      return await bridge.saveFile({ name: 'saved.stulooma', kind: 'project', data: new TextEncoder().encode('saved locally') });
    })).toBe(true);
    expect(await readFile(destination, 'utf8')).toBe('saved locally');
    await page.getByRole('button', { name: '텍스트 추가', exact: true }).click();
    await page.getByRole('textbox', { name: '텍스트 내용' }).fill('Desktop round-trip');
    await page.getByRole('textbox', { name: '프로젝트 이름' }).fill('Desktop round-trip');
    await page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)' }).click();
    await expect(page.getByText('프로젝트를 저장했습니다.', { exact: true })).toBeVisible();
    const savedProject = await readFile(destination);
    expect([...savedProject.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(savedProject)['manifest.json'])) as { layers: { text?: string }[] };
    expect(manifest.layers.some(layer => layer.text === 'Desktop round-trip')).toBe(true);
    await application.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, destination);
    await page.getByRole('button', { name: '새 프로젝트 (Ctrl+N)' }).click();
    await page.getByRole('button', { name: '프로젝트 열기 (Ctrl+O)' }).click();
    await expect(page.getByRole('textbox', { name: '프로젝트 이름' })).toHaveValue('Desktop round-trip');
    await expect(page.getByText('편집 가능한 프로젝트를 열었습니다.', { exact: true })).toBeVisible();
    const invalidRejected = await page.evaluate(async () => {
      const bridge = (window as unknown as { stulooma: { saveFile: (request: unknown) => Promise<boolean> } }).stulooma;
      try { await bridge.saveFile({ name: '../escape.stulooma', kind: 'project', data: new Uint8Array([1]) }); return false; }
      catch { return true; }
    });
    expect(invalidRejected).toBe(true);
    const localBlob = await page.evaluate(async () => {
      const url = URL.createObjectURL(new Blob(['embedded model texture']));
      try { return await (await fetch(url)).text(); } finally { URL.revokeObjectURL(url); }
    });
    expect(localBlob).toBe('embedded model texture');
    const offline = await page.evaluate(async () => {
      try { await fetch('https://example.com/stulooma-test'); return false; } catch { return true; }
    });
    expect(offline).toBe(true);
    const windowCount = await application.windows().length;
    await page.evaluate(() => { window.open('https://example.com', '_blank'); });
    expect(application.windows().length).toBe(windowCount);
    await page.screenshot({ path: 'test-results/electron/desktop.png' });
    await page.getByRole('button', { name: '텍스트 추가', exact: true }).click();
    await application.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & { stuloomaClosePromptCount: number };
      state.stuloomaClosePromptCount = 0;
      dialog.showMessageBoxSync = () => { state.stuloomaClosePromptCount++; return 0; };
    });
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await expect.poll(() => application!.evaluate(() =>
      (globalThis as typeof globalThis & { stuloomaClosePromptCount: number }).stuloomaClosePromptCount)).toBe(1);
    expect(page.isClosed()).toBe(false);
    await application.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    await application.close();
    expect(page.isClosed()).toBe(true);
    application = undefined;
  } finally {
    await application?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('a project passed at startup opens after the renderer is ready', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'stulooma-open-'));
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      executablePath: process.env.STULOOMA_TEST_EXECUTABLE || undefined,
      args: [...(process.env.STULOOMA_TEST_EXECUTABLE ? [] : ['.']), path.resolve('samples/projects/korean-front-back.stulooma'),
        ...(process.env.STULOOMA_CI_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      env: { ...process.env, XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_CACHE_HOME: path.join(temporary, 'cache') },
    });
    const page = await application.firstWindow();
    await expect(page.getByRole('textbox', { name: '프로젝트 이름' })).toHaveValue('서울 유니폼 — 김수현 23');
    await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  } finally {
    await application?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
