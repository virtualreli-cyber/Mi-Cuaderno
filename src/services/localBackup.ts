import type { GradebookWorkspace } from '../types/gradebook';

export const BACKUP_FILENAME = 'Mi Cuaderno.json';

const HANDLE_DB_NAME = 'cuaderno_profesor_backup_handles_v1';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'backup_dir';
const BACKUP_META_KEY = 'cuaderno_local_backup_meta_v1';

export type BackupPermissionState = 'granted' | 'prompt' | 'denied';

export interface BackupWritableStream {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

export interface BackupFileHandle {
  name: string;
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<BackupWritableStream>;
}

export interface BackupDirectoryHandle {
  name: string;
  kind?: 'directory';
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BackupFileHandle>;
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<BackupPermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<BackupPermissionState>;
}

export interface LocalBackupMeta {
  folderName: string | null;
  lastSavedAt: string | null;
  lastBackedUpUpdatedAt: string | null;
}

export type AutoBackupStatus =
  | 'UNSUPPORTED'
  | 'UNCONFIGURED'
  | 'ACTIVE'
  | 'NEEDS_PERMISSION'
  | 'SAVING'
  | 'ERROR';

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }) => Promise<BackupDirectoryHandle>;
};

export function isDirectoryPickerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
  );
}

export function loadLocalBackupMeta(): LocalBackupMeta {
  try {
    const raw = localStorage.getItem(BACKUP_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalBackupMeta>;
      return {
        folderName: typeof parsed.folderName === 'string' ? parsed.folderName : null,
        lastSavedAt: typeof parsed.lastSavedAt === 'string' ? parsed.lastSavedAt : null,
        lastBackedUpUpdatedAt:
          typeof parsed.lastBackedUpUpdatedAt === 'string'
            ? parsed.lastBackedUpUpdatedAt
            : null,
      };
    }
  } catch {
    // ignore corrupted backup meta
  }
  return {
    folderName: null,
    lastSavedAt: null,
    lastBackedUpUpdatedAt: null,
  };
}

export function saveLocalBackupMeta(meta: LocalBackupMeta): void {
  try {
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify(meta));
  } catch {
    // ignore quota errors
  }
}

function openHandleDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(HANDLE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(HANDLE_STORE)) {
          req.result.createObjectStore(HANDLE_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveBackupDirHandle(handle: BackupDirectoryHandle): Promise<void> {
  const db = await openHandleDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadBackupDirHandle(): Promise<BackupDirectoryHandle | null> {
  const db = await openHandleDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as BackupDirectoryHandle | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function clearBackupDirHandle(): Promise<void> {
  saveLocalBackupMeta({
    folderName: null,
    lastSavedAt: null,
    lastBackedUpUpdatedAt: null,
  });
  const db = await openHandleDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function queryBackupFolderPermission(
  handle: BackupDirectoryHandle | null
): Promise<BackupPermissionState | 'none'> {
  if (!handle) return 'none';
  if (typeof handle.queryPermission !== 'function') return 'granted';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'prompt';
  }
}

export async function ensureBackupFolderPermission(
  handle: BackupDirectoryHandle,
  interactive: boolean
): Promise<BackupPermissionState> {
  const current = await queryBackupFolderPermission(handle);
  if (current === 'granted') return 'granted';
  if (!interactive || typeof handle.requestPermission !== 'function') {
    return current === 'denied' ? 'denied' : 'prompt';
  }
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'prompt';
  }
}

export async function pickBackupFolder(): Promise<BackupDirectoryHandle | null> {
  if (!isDirectoryPickerSupported()) return null;
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker!;
  const handle = await picker({
    id: 'mi-cuaderno-backups',
    mode: 'readwrite',
    startIn: 'documents',
  });
  const perm = await ensureBackupFolderPermission(handle, true);
  if (perm !== 'granted') {
    throw new Error('No se concedió permiso de escritura en la carpeta seleccionada.');
  }
  await saveBackupDirHandle(handle);
  const prevMeta = loadLocalBackupMeta();
  saveLocalBackupMeta({
    ...prevMeta,
    folderName: handle.name,
  });
  return handle;
}

/**
 * Writes `Mi Cuaderno.json` directly inside the chosen directory handle,
 * atomically replacing any existing `Mi Cuaderno.json` without prompting.
 */
export async function writeBackupToDirectory(
  handle: BackupDirectoryHandle,
  workspace: GradebookWorkspace
): Promise<LocalBackupMeta> {
  const fileHandle = await handle.getFileHandle(BACKUP_FILENAME, { create: true });
  const writable = await fileHandle.createWritable({ keepExistingData: false });
  const jsonStr = JSON.stringify(workspace, null, 2);
  try {
    await writable.write(jsonStr);
    await writable.close();
  } catch (err) {
    try {
      await writable.close();
    } catch {
      // ignore close failure on abort
    }
    throw err;
  }

  const nextMeta: LocalBackupMeta = {
    folderName: handle.name,
    lastSavedAt: new Date().toISOString(),
    lastBackedUpUpdatedAt: workspace.updatedAt,
  };
  saveLocalBackupMeta(nextMeta);
  return nextMeta;
}

/**
 * Standard browser download fallback always named `Mi Cuaderno.json`
 * (used when the browser lacks writable directory handles or no folder is configured).
 */
export function downloadBackupFile(workspace: GradebookWorkspace): void {
  const jsonStr = JSON.stringify(workspace, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = BACKUP_FILENAME;
  a.click();
  URL.revokeObjectURL(url);

  const prevMeta = loadLocalBackupMeta();
  saveLocalBackupMeta({
    ...prevMeta,
    lastSavedAt: new Date().toISOString(),
    lastBackedUpUpdatedAt: workspace.updatedAt,
  });
}
