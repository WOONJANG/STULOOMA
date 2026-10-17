import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { channels, EXPORT_MAX_BYTES, PROJECT_MAX_BYTES, type ExportKind, type SaveFileRequest } from './channels';

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
        return { name: path.basename(selected), data: new Uint8Array(data) };
      } finally { await file.close(); }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw new Error('Unable to read the selected project');
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
