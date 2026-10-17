import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { channels, EXPORT_MAX_BYTES, PROJECT_MAX_BYTES, type ExportKind, type SaveFileRequest, type SaveProjectRequest } from './channels';

const extensions: Record<ExportKind, string> = { project: 'stulooma', png: 'png', jpg: 'jpg', glb: 'glb' };

function validateSaveRequest(request: unknown): SaveFileRequest {
  if (!request || typeof request !== 'object') throw new Error('Invalid save request');
  const candidate = request as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 180 ||
      /[\x00-\x1f<>:"/\\|?*]/.test(candidate.name) || candidate.name === '.' || candidate.name === '..' ||
      typeof candidate.kind !== 'string' || !Object.hasOwn(extensions, candidate.kind) ||
      !(candidate.data instanceof Uint8Array) || candidate.data.byteLength === 0 ||
      candidate.data.byteLength > (candidate.kind === 'project' ? PROJECT_MAX_BYTES : EXPORT_MAX_BYTES)) {
    throw new Error('Invalid file name, file kind, or file size');
  }
  return candidate as unknown as SaveFileRequest;
}

function validateProjectRequest(request: unknown): SaveProjectRequest {
  if (!request || typeof request !== 'object') throw new Error('Invalid project save request');
  const candidate = request as Record<string, unknown>;
  validateSaveRequest({ name: candidate.name, data: candidate.data, kind: 'project' });
  if ((candidate.documentToken !== undefined &&
      (typeof candidate.documentToken !== 'string' || !/^[a-f0-9-]{36}$/.test(candidate.documentToken))) ||
      (candidate.saveAs !== undefined && typeof candidate.saveAs !== 'boolean')) {
    throw new Error('Invalid project destination');
  }
  return candidate as unknown as SaveProjectRequest;
}

// Write next to the destination, then replace it atomically. Never leave a partial project behind.
async function atomicWrite(destination: string, data: Uint8Array): Promise<void> {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export function registerFileHandlers(options: {
  getWindow: () => BrowserWindow | null;
  isTrustedUrl: (url: string) => boolean;
  takePendingPath: () => string | undefined;
}): void {
  let dialogBusy = false;
  // Capabilities belong to a webContents, so another window cannot claim an approved path.
  // Weak ownership also drops all destinations when the originating window is destroyed.
  const projectDestinations = new WeakMap<WebContents, Map<string, string>>();
  function destinations(window: BrowserWindow): Map<string, string> {
    let approved = projectDestinations.get(window.webContents);
    if (!approved) {
      approved = new Map();
      projectDestinations.set(window.webContents, approved);
    }
    return approved;
  }
  function remember(window: BrowserWindow, destination: string): string {
    const token = randomUUID();
    destinations(window).set(token, destination);
    return token;
  }
  function caller(event: IpcMainInvokeEvent): BrowserWindow {
    const window = options.getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents ||
        !event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
        !options.isTrustedUrl(event.senderFrame.url)) {
      throw new Error('Untrusted IPC caller');
    }
    return window;
  }

  ipcMain.handle(channels.openProject, async (event) => {
    const window = caller(event);
    if (dialogBusy) throw new Error('A file dialog is already open');
    dialogBusy = true;
    try {
      let selected = options.takePendingPath();
      if (!selected) {
        const result = await dialog.showOpenDialog(window, {
          title: 'STULOOMA 프로젝트 열기', properties: ['openFile'],
          filters: [{ name: 'STULOOMA 프로젝트', extensions: ['stulooma'] }],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        selected = result.filePaths[0];
      }
      if (path.extname(selected).toLowerCase() !== '.stulooma') throw new Error('Choose a .stulooma project');
      const file = await open(selected, 'r');
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size === 0 || stat.size > PROJECT_MAX_BYTES) {
          throw new Error('Project size must be between 1 byte and 64 MB');
        }
        const data = Buffer.allocUnsafe(stat.size);
        let offset = 0;
        while (offset < data.length) {
          const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        const probe = await file.read(Buffer.alloc(1), 0, 1, offset);
        if (offset !== stat.size || probe.bytesRead) throw new Error('Project changed while reading; try again');
        return { name: path.basename(selected), data: new Uint8Array(data), documentToken: remember(window, selected) };
      } finally { await file.close(); }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw new Error('Unable to read the selected project');
      throw error;
    } finally { dialogBusy = false; }
  });

  ipcMain.handle(channels.saveProject, async (event, input: unknown) => {
    const window = caller(event);
    const request = validateProjectRequest(input);
    const approved = destinations(window);
    if (request.documentToken && !approved.has(request.documentToken)) {
      throw new Error('Project destination is no longer available; use Save As');
    }
    // Includes disk writes, not just dialogs: overlapping saves must never finish out of order.
    if (dialogBusy) throw new Error('A file operation is already in progress');
    dialogBusy = true;
    try {
      let destination = request.documentToken && !request.saveAs ? approved.get(request.documentToken) : undefined;
      let token = request.documentToken;
      if (!destination) {
        const existing = request.documentToken ? approved.get(request.documentToken) : undefined;
        const name = request.name.replace(/\.stulooma$/i, '');
        const result = await dialog.showSaveDialog(window, {
          title: request.saveAs ? 'STULOOMA 프로젝트 다른 이름으로 저장' : 'STULOOMA 프로젝트 저장',
          defaultPath: existing ?? `${name}.stulooma`,
          filters: [{ name: 'STULOOMA 프로젝트', extensions: ['stulooma'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });
        if (result.canceled || !result.filePath) return null;
        destination = result.filePath;
        if (path.extname(destination).toLowerCase() !== '.stulooma') {
          throw new Error('File name must end in .stulooma');
        }
        // Commit the new capability only after the complete atomic write succeeds.
        token = undefined;
      }
      await atomicWrite(destination, request.data);
      return { name: path.basename(destination), documentToken: token ?? remember(window, destination) };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw new Error('Unable to save the selected project');
      throw error;
    } finally { dialogBusy = false; }
  });

  ipcMain.handle(channels.saveFile, async (event, input: unknown) => {
    const window = caller(event);
    const request = validateSaveRequest(input);
    if (dialogBusy) throw new Error('A file dialog is already open');
    dialogBusy = true;
    try {
      const extension = extensions[request.kind];
      const name = request.name.replace(/\.(stulooma|png|jpe?g|glb)$/i, '');
      const result = await dialog.showSaveDialog(window, {
        title: request.kind === 'project' ? 'STULOOMA 프로젝트 저장' : '파일 내보내기',
        defaultPath: `${name}.${extension}`,
        filters: [{ name: request.kind === 'project' ? 'STULOOMA 프로젝트' : extension.toUpperCase(), extensions: [extension] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return false;
      if (path.extname(result.filePath).toLowerCase() !== `.${extension}`) {
        throw new Error(`File name must end in .${extension}`);
      }
      await atomicWrite(result.filePath, request.data);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw new Error('Unable to save the selected file');
      throw error;
    } finally { dialogBusy = false; }
  });
}
