export const channels = {
  openProject: 'stulooma:open-project',
  saveFile: 'stulooma:save-file',
  saveProject: 'stulooma:save-project',
  projectOpenRequest: 'stulooma:project-open-request',
  rendererReady: 'stulooma:renderer-ready',
} as const;

export type ExportKind = 'project' | 'png' | 'jpg' | 'glb' | 'svg';
export interface SaveFileRequest {
  name: string;
  data: Uint8Array;
  kind: ExportKind;
}
export interface OpenProjectResult {
  name: string;
  data: Uint8Array;
  documentToken: string;
}

// The token identifies a user-approved destination in this desktop session. It is never a path.
export interface SaveProjectRequest {
  name: string;
  data: Uint8Array;
  documentToken?: string;
  saveAs?: boolean;
}
export interface SavedProjectResult {
  name: string;
  documentToken: string;
}

export const PROJECT_MAX_BYTES = 64 * 1024 * 1024;
export const EXPORT_MAX_BYTES = 128 * 1024 * 1024;
