import { contextBridge, ipcRenderer } from 'electron';
import { channels, type SaveFileRequest, type SaveProjectRequest } from '../ipc/channels';

// Sandboxed renderer receives no filesystem, process, generic IPC, or path capabilities.
contextBridge.exposeInMainWorld('stulooma', Object.freeze({
  openProject: () => ipcRenderer.invoke(channels.openProject),
  saveFile: (request: SaveFileRequest) => ipcRenderer.invoke(channels.saveFile, {
    name: request?.name, data: request?.data, kind: request?.kind,
  }),
  saveProject: (request: SaveProjectRequest) => ipcRenderer.invoke(channels.saveProject, {
    name: request?.name, data: request?.data,
    documentToken: request?.documentToken, saveAs: request?.saveAs,
  }),
}));

ipcRenderer.on(channels.projectOpenRequest, () => {
  window.dispatchEvent(new CustomEvent('stulooma:open-project'));
});

window.addEventListener('stulooma:ready', () => {
  ipcRenderer.send(channels.rendererReady);
});
