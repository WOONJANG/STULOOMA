import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { OpenProjectResult, SaveProjectRequest, SavedProjectResult } from '../../electron/ipc/channels';
import { dataUrlToBytes, loadProject } from '../../src/core/project';
import type { ProjectDocument } from '../../src/types/project';

interface NativeBridge {
  openProject: () => Promise<OpenProjectResult | null>;
  saveProject: (request: SaveProjectRequest) => Promise<SavedProjectResult | null>;
}

test('desktop uses a restricted bridge, opens and atomically saves native files', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'stulooma-desktop-'));
  let application: ElectronApplication | undefined;
  try {
    const source = path.join(temporary, 'source.stulooma');
    const destination = path.join(temporary, 'saved.stulooma');
    const copy = path.join(temporary, 'copy.stulooma');
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
    await page.waitForURL('app://stulooma/index.html');
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
    expect(bridge).toEqual({ methods: ['openProject', 'saveFile', 'saveProject'], frozen: true, node: 'undefined', process: 'undefined' });

    await application.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.source] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.destination });
    }, { source, destination });
    const opened = await page.evaluate(async () => {
      const bridge = (window as unknown as { stulooma: NativeBridge }).stulooma;
      const result = await bridge.openProject();
      if (!result) throw new Error('Expected native project');
      return { name: result.name, text: new TextDecoder().decode(result.data), token: result.documentToken, keys: Object.keys(result).sort() };
    });
    expect(opened).toEqual({ name: 'source.stulooma', text: 'local project bytes', token: expect.any(String), keys: ['data', 'documentToken', 'name'] });
    expect(opened.token).toMatch(/^[a-f0-9-]{36}$/);
    expect(await page.evaluate(async () => {
      const bridge = (window as unknown as { stulooma: { saveFile: (request: unknown) => Promise<boolean> } }).stulooma;
      return await bridge.saveFile({ name: 'saved.stulooma', kind: 'project', data: new TextEncoder().encode('saved locally') });
    })).toBe(true);
    expect(await readFile(destination, 'utf8')).toBe('saved locally');

    // The renderer holds an opaque destination, never a filesystem path. First save prompts;
    // repeat save writes the approved file, and canceling Save As preserves that destination.
    await application.evaluate(({ dialog }, selected) => {
      const state = globalThis as typeof globalThis & { saveDialogCount: number; saveCanceled: boolean; saveDestination: string };
      state.saveDialogCount = 0;
      state.saveCanceled = false;
      state.saveDestination = selected;
      dialog.showSaveDialog = async () => {
        state.saveDialogCount++;
        return { canceled: state.saveCanceled, filePath: state.saveCanceled ? '' : state.saveDestination };
      };
    }, destination);
    const firstSave = await page.evaluate(async () => {
      const native = (window as unknown as { stulooma: NativeBridge }).stulooma;
      return native.saveProject({ name: 'saved.stulooma', data: new TextEncoder().encode('first document save') });
    });
    expect(firstSave).toEqual({ name: 'saved.stulooma', documentToken: expect.any(String) });
    expect(Object.keys(firstSave!).sort()).toEqual(['documentToken', 'name']);
    const save = async (token: string | undefined, text: string, saveAs = false) => page.evaluate(async (request) => {
      const native = (window as unknown as { stulooma: NativeBridge }).stulooma;
      return native.saveProject({ name: 'saved.stulooma', data: new TextEncoder().encode(request.text), documentToken: request.token, saveAs: request.saveAs });
    }, { token, text, saveAs });
    const dialogCount = () => application!.evaluate(() =>
      (globalThis as typeof globalThis & { saveDialogCount: number }).saveDialogCount);
    expect(await save(firstSave!.documentToken, 'repeat save')).toEqual(firstSave);
    expect(await readFile(destination, 'utf8')).toBe('repeat save');
    expect(await dialogCount()).toBe(1);
    await application.evaluate(() => {
      (globalThis as typeof globalThis & { saveCanceled: boolean }).saveCanceled = true;
    });
    expect(await save(firstSave!.documentToken, 'canceled copy', true)).toBeNull();
    expect(await readFile(destination, 'utf8')).toBe('repeat save');
    expect(await save(firstSave!.documentToken, 'save after cancel')).toEqual(firstSave);
    expect(await readFile(destination, 'utf8')).toBe('save after cancel');
    expect(await dialogCount()).toBe(2);
    await application.evaluate((_electron, selected) => {
      const state = globalThis as typeof globalThis & { saveCanceled: boolean; saveDestination: string };
      state.saveCanceled = false;
      state.saveDestination = selected;
    }, copy);
    const savedCopy = await save(firstSave!.documentToken, 'copy document', true);
    expect(savedCopy?.name).toBe('copy.stulooma');
    expect(savedCopy?.documentToken).not.toBe(firstSave?.documentToken);
    expect(await save(savedCopy!.documentToken, 'repeat copy')).toEqual(savedCopy);
    expect(await readFile(copy, 'utf8')).toBe('repeat copy');
    expect(await readFile(destination, 'utf8')).toBe('save after cancel');
    expect(await save(opened.token, 'opened destination save')).toEqual({ name: 'source.stulooma', documentToken: opened.token });
    expect(await readFile(source, 'utf8')).toBe('opened destination save');
    expect(await dialogCount()).toBe(3);
    // Unknown capabilities must fail rather than opening a fallback dialog or writing a path.
    expect(await page.evaluate(async () => {
      const native = (window as unknown as { stulooma: NativeBridge }).stulooma;
      try {
        await native.saveProject({ name: 'unsafe.stulooma', data: new Uint8Array([1]), documentToken: '00000000-0000-0000-0000-000000000000' });
        return false;
      } catch { return true; }
    })).toBe(true);
    expect(await dialogCount()).toBe(3);
    // A separate, unsaved document cannot silently inherit the previous document's path.
    await application.evaluate(() => {
      (globalThis as typeof globalThis & { saveCanceled: boolean }).saveCanceled = true;
    });
    expect(await save(undefined, 'new document')).toBeNull();
    expect(await dialogCount()).toBe(4);
    expect(await readFile(copy, 'utf8')).toBe('repeat copy');
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    expect(await page.evaluate(() => (window as unknown as { stulooma: NativeBridge }).stulooma.openProject())).toBeNull();
    expect(await save(savedCopy!.documentToken, 'save after open cancel')).toEqual(savedCopy);
    expect(await readFile(copy, 'utf8')).toBe('save after open cancel');
    // Hold one native dialog open and verify another save cannot overtake that operation.
    await application.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & { pendingSaveDialog?: (result: { canceled: boolean; filePath: string }) => void };
      state.pendingSaveDialog = undefined;
      dialog.showSaveDialog = () => new Promise(resolve => { state.pendingSaveDialog = resolve; });
    });
    const pendingSave = save(undefined, 'pending save');
    await expect.poll(() => application!.evaluate(() =>
      typeof (globalThis as typeof globalThis & { pendingSaveDialog?: unknown }).pendingSaveDialog)).toBe('function');
    expect(await page.evaluate(async (token) => {
      const native = (window as unknown as { stulooma: NativeBridge }).stulooma;
      try { await native.saveProject({ name: 'saved.stulooma', data: new Uint8Array([1]), documentToken: token }); return false; }
      catch { return true; }
    }, savedCopy!.documentToken)).toBe(true);
    await application.evaluate(() => {
      (globalThis as typeof globalThis & { pendingSaveDialog: (result: { canceled: boolean; filePath: string }) => void })
        .pendingSaveDialog({ canceled: true, filePath: '' });
    });
    expect(await pendingSave).toBeNull();
    expect(await readFile(copy, 'utf8')).toBe('save after open cancel');
    await application.evaluate(({ dialog }, selected) => {
      const state = globalThis as typeof globalThis & { saveCanceled: boolean; saveDestination: string };
      state.saveCanceled = false;
      state.saveDestination = selected;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected });
    }, destination);

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
    await page.waitForURL('app://stulooma/index.html');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('textbox', { name: '프로젝트 이름' })).toHaveValue('서울 유니폼 — 김수현 23');
    await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
  } finally {
    await application?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('desktop UI shortcuts preserve document destinations and commit focused drafts', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'stulooma-save-ui-'));
  let application: ElectronApplication | undefined;
  try {
    const original = path.join(temporary, 'opened.stulooma');
    const copy = path.join(temporary, 'save-as.stulooma');
    const fresh = path.join(temporary, 'new.stulooma');
    const invalid = path.join(temporary, 'invalid.stulooma');
    await writeFile(original, await readFile('samples/projects/korean-front-back.stulooma'));
    await writeFile(invalid, 'not a project archive');
    application = await electron.launch({
      executablePath: process.env.STULOOMA_TEST_EXECUTABLE || undefined,
      args: [...(process.env.STULOOMA_TEST_EXECUTABLE ? [] : ['.']), original,
        ...(process.env.STULOOMA_CI_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      env: { ...process.env, XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_CACHE_HOME: path.join(temporary, 'cache') },
    });
    const page = await application.firstWindow();
    await page.waitForURL('app://stulooma/index.html');
    await page.waitForLoadState('domcontentloaded');
    const projectName = page.getByRole('textbox', { name: '프로젝트 이름' });
    const saveButton = page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)' });
    await expect(projectName).toHaveValue('서울 유니폼 — 김수현 23');
    await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
    await application.evaluate(({ dialog }, selected) => {
      const state = globalThis as typeof globalThis & { uiSaveDialogCount: number; uiSaveCanceled: boolean; uiSaveDestination: string };
      state.uiSaveDialogCount = 0;
      state.uiSaveCanceled = true;
      state.uiSaveDestination = selected;
      dialog.showSaveDialog = async () => {
        state.uiSaveDialogCount++;
        return { canceled: state.uiSaveCanceled, filePath: state.uiSaveCanceled ? '' : state.uiSaveDestination };
      };
    }, copy);
    const countDialogs = () => application!.evaluate(() =>
      (globalThis as typeof globalThis & { uiSaveDialogCount: number }).uiSaveDialogCount);
    const manifestAt = async (file: string) => JSON.parse(new TextDecoder().decode(unzipSync(await readFile(file))['manifest.json'])) as {
      name: string; layers: { text?: string }[];
    };
    const shortcut = async (key: string) => {
      await saveButton.focus();
      await page.keyboard.press(key);
    };

    // Editing a loaded file and pressing Ctrl+S writes that selected file immediately.
    await projectName.fill('Native open saved');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await manifestAt(original)).name).toBe('Native open saved');
    expect(await countDialogs()).toBe(0);
    // Text drafts commit on blur. Saving while the textarea is focused must include the draft.
    await page.getByRole('button', { name: '텍스트 추가', exact: true }).click();
    await page.getByRole('textbox', { name: '텍스트 내용' }).fill('Focused native draft');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await manifestAt(original)).layers.some(layer => layer.text === 'Focused native draft')).toBe(true);
    expect(await countDialogs()).toBe(0);

    // Canceling Save As preserves the original approved destination for subsequent Ctrl+S.
    await shortcut('Control+Shift+s');
    await expect.poll(countDialogs).toBe(1);
    await expect(page.getByRole('status').filter({ hasText: '프로젝트 저장 중' })).toBeHidden();
    await projectName.fill('Original after canceled copy');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await manifestAt(original)).name).toBe('Original after canceled copy');
    expect(await countDialogs()).toBe(1);

    // Successful Save As switches future saves to the new file while preserving the original.
    await application.evaluate(() => {
      (globalThis as typeof globalThis & { uiSaveCanceled: boolean }).uiSaveCanceled = false;
    });
    await shortcut('Control+Shift+s');
    await expect.poll(countDialogs).toBe(2);
    await expect.poll(async () => (await manifestAt(copy)).name).toBe('Original after canceled copy');
    await projectName.fill('Copy destination updated');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await manifestAt(copy)).name).toBe('Copy destination updated');
    expect((await manifestAt(original)).name).toBe('Original after canceled copy');
    expect(await countDialogs()).toBe(2);

    // New documents must prompt once and must never inherit the previous file's binding.
    await page.getByRole('button', { name: '새 프로젝트 (Ctrl+N)' }).click();
    await application.evaluate((_electron, selected) => {
      (globalThis as typeof globalThis & { uiSaveDestination: string }).uiSaveDestination = selected;
    }, fresh);
    await projectName.fill('Fresh project destination');
    await page.keyboard.press('Control+s');
    await expect.poll(countDialogs).toBe(3);
    await expect.poll(async () => (await manifestAt(fresh)).name).toBe('Fresh project destination');
    expect((await manifestAt(copy)).name).toBe('Copy destination updated');

    // A rejected archive cannot replace the current document's approved destination.
    await application.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, invalid);
    await page.getByRole('button', { name: '프로젝트 열기 (Ctrl+O)' }).click();
    await expect(page.getByRole('dialog', { name: '작업을 완료하지 못했습니다' })).toBeVisible();
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await expect(projectName).toHaveValue('Fresh project destination');
    await projectName.fill('Fresh after rejected open');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await manifestAt(fresh)).name).toBe('Fresh after rejected open');
    expect(await countDialogs()).toBe(3);
    expect(await readFile(invalid, 'utf8')).toBe('not a project archive');

    // A focused draft can be the only change in an otherwise saved document.
    // Closing must commit it before checking dirty state and allow canceling.
    await page.getByRole('button', { name: '텍스트 추가', exact: true }).click();
    await shortcut('Control+s');
    await expect.poll(async () => (await manifestAt(fresh)).layers.length).toBe(1);
    await page.getByRole('textbox', { name: '텍스트 내용' }).fill('닫기 전 한글 초안');
    await application.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & { draftClosePrompts: number };
      state.draftClosePrompts = 0;
      dialog.showMessageBoxSync = () => { state.draftClosePrompts++; return 0; };
    });
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await expect.poll(() => application!.evaluate(() =>
      (globalThis as typeof globalThis & { draftClosePrompts: number }).draftClosePrompts)).toBe(1);
    expect(page.isClosed()).toBe(false);
    await shortcut('Control+s');
    await expect.poll(async () => (await manifestAt(fresh)).layers.some(layer => layer.text === '닫기 전 한글 초안')).toBe(true);
    await application.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  } finally {
    await application?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('desktop vector edits preserve legacy assets and round-trip through native project and SVG saves', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'stulooma-vector-native-'));
  let application: ElectronApplication | undefined;
  try {
    const original = path.join(temporary, 'legacy.stulooma');
    const destination = path.join(temporary, 'editable-vector.stulooma');
    const svgDestination = path.join(temporary, 'editable-vector.svg');
    const legacyBytes = await readFile('samples/projects/korean-front-back.stulooma');
    const legacy = await loadProject(legacyBytes); await writeFile(original, legacyBytes);
    application = await electron.launch({
      executablePath: process.env.STULOOMA_TEST_EXECUTABLE || undefined,
      args: [...(process.env.STULOOMA_TEST_EXECUTABLE ? [] : ['.']), original,
        ...(process.env.STULOOMA_CI_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      env: { ...process.env, XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_CACHE_HOME: path.join(temporary, 'cache') },
    });
    const page = await application.firstWindow();
    await page.waitForURL('app://stulooma/index.html');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('textbox', { name: '프로젝트 이름' })).toHaveValue(legacy.name);
    await expect(page.getByTestId('viewer-state')).toHaveAttribute('data-state', 'ready');
    await page.getByRole('button', { name: 'Vector Studio', exact: true }).click();
    const studio = page.getByTestId('vector-studio'); await expect(studio).toBeVisible();
    await studio.getByLabel('벡터 SVG 가져오기').setInputFiles({
      name: 'native-vector.svg', mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect id="native-logo" x="60" y="70" width="240" height="190" rx="20" fill="#55d5b0"/></svg>'),
    });
    await studio.getByTitle('native-logo', { exact: true }).click();
    await studio.getByLabel('벡터 칠 색상').fill('#c9248a');
    await studio.getByLabel('벡터 적용 부위').selectOption('FRONT');
    await studio.getByRole('button', { name: '현재 아트보드 적용', exact: true }).click();
    await expect(studio.getByRole('button', { name: '앞판 벡터 연결 해제' })).toBeVisible();

    await application.evaluate(({ dialog }, selected) => {
      const state = globalThis as typeof globalThis & { vectorSaveDialogs: number };
      state.vectorSaveDialogs = 0;
      dialog.showSaveDialog = async () => { state.vectorSaveDialogs++; return { canceled: false, filePath: selected }; };
    }, destination);
    const saveButton = page.getByRole('button', { name: '프로젝트 저장 (Ctrl+S)' });
    await saveButton.focus(); await page.keyboard.press('Control+Shift+s');
    const readSaved = async (): Promise<ProjectDocument | null> => {
      try { return await loadProject(await readFile(destination)); } catch { return null; }
    };
    await expect.poll(async () => (await readSaved())?.version).toBe(2);
    const saved = (await readSaved())!; const vectorLayer = saved.layers.find(layer => layer.type === 'vector')!;
    const vectorDocument = saved.vectorDocuments?.[vectorLayer.vectorDocumentId!]!;
    expect(vectorLayer.regionId).toBe('FRONT'); expect(vectorDocument.objects[0]?.geometry?.contours[0]?.anchors.length).toBeGreaterThan(3);
    expect(vectorDocument.objects[0]?.fill).toEqual({ type: 'solid', color: '#c9248a', opacity: 1 });
    expect(saved.layers.filter(layer => layer.type !== 'vector')).toEqual(legacy.layers);
    for (const [id, asset] of Object.entries(legacy.assets)) expect(dataUrlToBytes(saved.assets[id]!.data, asset.mime)).toEqual(dataUrlToBytes(asset.data, asset.mime));
    expect(await readFile(original)).toEqual(legacyBytes);

    // Loading the native ZIP restores editable geometry, then a new edit updates
    // both the native project destination and the independent SVG export.
    await application.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, destination);
    await page.getByRole('button', { name: '새 프로젝트 (Ctrl+N)' }).click();
    await page.getByRole('button', { name: '프로젝트 열기 (Ctrl+O)' }).click();
    await expect(page.getByRole('textbox', { name: '프로젝트 이름' })).toHaveValue(legacy.name);
    await expect(studio.getByTitle('native-logo', { exact: true })).toBeVisible();
    await studio.getByTitle('native-logo', { exact: true }).click();
    await expect(studio.getByLabel('벡터 칠 색상')).toHaveValue('#c9248a');
    await studio.getByLabel('벡터 칠 색상').fill('#2472dc');
    await saveButton.focus(); await page.keyboard.press('Control+s');
    await expect.poll(async () => (await readSaved())?.vectorDocuments?.[vectorDocument.id]?.objects[0]?.fill).toEqual({ type: 'solid', color: '#2472dc', opacity: 1 });
    expect(await application.evaluate(() => (globalThis as typeof globalThis & { vectorSaveDialogs: number }).vectorSaveDialogs)).toBe(1);
    await application.evaluate(({ dialog }, selected) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected });
    }, svgDestination);
    await studio.getByRole('button', { name: 'SVG 내보내기', exact: true }).click();
    await expect.poll(async () => { try { return await readFile(svgDestination, 'utf8'); } catch { return ''; } }).toContain('#2472dc');
    const svgText = await readFile(svgDestination, 'utf8');
    expect(svgText).toMatch(/^(?:<\?xml[^>]*>\s*)?<svg\s/); expect(svgText).toContain('<path'); expect(svgText).not.toContain('<script');
    expect(await page.evaluate(async () => {
      const response = await fetch('/fonts/NotoSansCJKkr-Regular.otf');
      const bytes = new Uint8Array(await response.arrayBuffer());
      await document.fonts.load('48px "STULOOMA Noto Sans KR"', '서울 유니폼');
      return { ok: response.ok, mime: response.headers.get('content-type'), signature: String.fromCharCode(...bytes.subarray(0, 4)), loaded: [...document.fonts].some(face => face.family === 'STULOOMA Noto Sans KR' && face.status === 'loaded') };
    })).toEqual({ ok: true, mime: 'font/otf', signature: 'OTTO', loaded: true });
    await page.screenshot({ path: 'test-results/electron/vector-native.png' });
  } finally {
    await application?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
