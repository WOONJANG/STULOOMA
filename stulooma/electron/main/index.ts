import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session } from 'electron';
import { channels } from '../ipc/channels';
import { registerFileHandlers } from '../ipc/files';

const APPLICATION_URL = 'app://stulooma/index.html';
const appRoot = path.resolve(__dirname, '..');
const rendererRoot = path.join(appRoot, 'dist');
const developmentURL = !app.isPackaged && process.env.STULOOMA_DEV_URL
  ? new URL(process.env.STULOOMA_DEV_URL) : null;
if (developmentURL && (developmentURL.protocol !== 'http:' || developmentURL.hostname !== '127.0.0.1')) {
  throw new Error('Development renderer must use HTTP on 127.0.0.1');
}

// Treat the local renderer as a secure standard origin, without granting Node access.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('STULOOMA');
app.setAppUserModelId('com.stulooma.desktop');
let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
const pendingPaths: string[] = [];
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
};

function queueProject(file: string): void {
  if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.stulooma' || pendingPaths.length >= 16) return;
  pendingPaths.push(file);
  if (mainWindow && rendererReady) {
    mainWindow.webContents.send(channels.projectOpenRequest);
    mainWindow.show();
    mainWindow.focus();
  }
}

function isTrustedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (developmentURL) return url.origin === developmentURL.origin;
    return url.protocol === 'app:' && url.hostname === 'stulooma' && url.pathname === '/index.html';
  } catch { return false; }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  for (const arg of process.argv.slice(1)) queueProject(arg);
  app.on('open-file', (event, file) => { event.preventDefault(); queueProject(file); });
  app.on('second-instance', (_event, argv) => {
    for (const arg of argv.slice(1)) queueProject(arg);
    mainWindow?.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });

  void app.whenReady().then(async () => {
    protocol.handle('app', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'stulooma' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 });
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        const target = path.resolve(rendererRoot, relative);
        if (target !== rendererRoot && !target.startsWith(rendererRoot + path.sep)) return new Response(null, { status: 403 });
        const bytes = await readFile(target);
        return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), {
          headers: { 'Content-Type': contentTypes[path.extname(target)] ?? 'application/octet-stream' },
        });
      } catch { return new Response(null, { status: 404 }); }
    });

    const trustedSession = session.defaultSession;
    trustedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    trustedSession.setPermissionCheckHandler(() => false);
    trustedSession.on('will-download', (event) => event.preventDefault());
    trustedSession.webRequest.onBeforeRequest((details, callback) => {
      try {
        const url = new URL(details.url);
        const allowed = url.protocol === 'app:' || url.protocol === 'data:' || url.protocol === 'blob:' ||
          (developmentURL && url.hostname === '127.0.0.1' && url.port === developmentURL.port && ['http:', 'ws:'].includes(url.protocol));
        callback({ cancel: !allowed });
      } catch { callback({ cancel: true }); }
    });
    trustedSession.webRequest.onHeadersReceived((details, callback) => {
      const devConnections = developmentURL ? ` ${developmentURL.origin} ws://127.0.0.1:${developmentURL.port}` : '';
      const scripts = developmentURL ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
      const csp = `default-src 'self'; ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:${devConnections}; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });

    registerFileHandlers({ getWindow: () => mainWindow, isTrustedUrl, takePendingPath: () => pendingPaths.shift() });
    ipcMain.on(channels.rendererReady, (event) => {
      if (!mainWindow || event.sender !== mainWindow.webContents || !event.senderFrame ||
          event.senderFrame !== event.sender.mainFrame || !isTrustedUrl(event.senderFrame.url)) return;
      rendererReady = true;
      if (pendingPaths.length) mainWindow.webContents.send(channels.projectOpenRequest);
    });

    function createWindow(): void {
      rendererReady = false;
      mainWindow = new BrowserWindow({
        width: 1500, height: 960, minWidth: 1024, minHeight: 700,
        title: 'STULOOMA', backgroundColor: '#17191d', show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true, nodeIntegration: false, sandbox: true,
          webSecurity: true, allowRunningInsecureContent: false,
          spellcheck: false,
        },
      });
      Menu.setApplicationMenu(null);
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
      mainWindow.webContents.on('will-redirect', (event) => event.preventDefault());
      mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
      mainWindow.webContents.on('will-prevent-unload', (event) => {
        if (!mainWindow) return;
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'question', title: '저장하지 않은 변경 사항',
          message: '저장하지 않은 변경 사항이 있습니다.',
          detail: '계속 편집하여 프로젝트를 저장하거나, 변경 사항을 버리고 닫을 수 있습니다.',
          buttons: ['계속 편집', '저장하지 않고 닫기'], defaultId: 0, cancelId: 0, noLink: true,
        });
        // Electron uses preventDefault here to override the renderer's unload veto.
        if (choice === 1) event.preventDefault();
      });
      mainWindow.once('ready-to-show', () => mainWindow?.show());
      mainWindow.on('closed', () => { mainWindow = null; });
      void mainWindow.loadURL(developmentURL?.href ?? APPLICATION_URL);
    }
    createWindow();
    app.on('activate', () => { if (!mainWindow) createWindow(); });
  }).catch((error: unknown) => {
    console.error('STULOOMA desktop startup failed:', error instanceof Error ? error.message : 'Unknown error');
    app.exit(1);
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
