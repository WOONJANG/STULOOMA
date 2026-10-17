import type { ProjectDocument } from '../../types/project';
import { loadProject, saveProject } from './index';

const databaseName = 'STULOOMA-local-projects';
const storeName = 'recovery';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('이 환경에서는 IndexedDB 자동 저장을 사용할 수 없습니다.')); return; }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(storeName); };
    request.onerror = () => reject(request.error ?? new Error('자동 저장 공간을 열 수 없습니다.'));
    request.onblocked = () => reject(new Error('다른 창에서 자동 저장 공간을 사용 중입니다.'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode), request = action(tx.objectStore(storeName));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? request.error ?? new Error('자동 저장 작업이 실패했습니다.')); };
  });
}

export async function autosaveProject(project: ProjectDocument): Promise<void> {
  const bytes = await saveProject(project);
  await transaction('readwrite', (store) => store.put(bytes, 'latest'));
}

export async function restoreAutosave(): Promise<ProjectDocument | null> {
  const bytes: unknown = await transaction('readonly', (store) => store.get('latest'));
  if (bytes === undefined) return null;
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error('자동 저장 데이터가 손상되었습니다.');
  return loadProject(bytes);
}

export async function clearAutosave(): Promise<void> { await transaction('readwrite', (store) => store.delete('latest')); }
