export const channels = {
  openProject: 'stulooma:open-project',
  saveFile: 'stulooma:save-file',
  projectOpenRequest: 'stulooma:project-open-request',
  rendererReady: 'stulooma:renderer-ready',
} as const;

export type ExportKind = 'project' | 'png' | 'jpg' | 'glb';
export interface SaveFileRequest {
  name: string;
  data: Uint8Array;
  kind: ExportKind;
}
export interface OpenProjectResult {
  name: string;
  data: Uint8Array;
}

export const PROJECT_MAX_BYTES = 64 * 1024 * 1024;
export const EXPORT_MAX_BYTES = 128 * 1024 * 1024;
