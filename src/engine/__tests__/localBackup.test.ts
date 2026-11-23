import { describe, expect, it, vi } from 'vitest';
import { createSeedWorkspace } from '../../data/seedData';
import {
  BACKUP_FILENAME,
  ensureBackupFolderPermission,
  queryBackupFolderPermission,
  writeBackupToDirectory,
  type BackupDirectoryHandle,
} from '../../services/localBackup';

describe('Local folder auto-backup service', () => {
  it('uses exact fixed filename "Mi Cuaderno.json"', () => {
    expect(BACKUP_FILENAME).toBe('Mi Cuaderno.json');
  });

  it('writes and overwrites "Mi Cuaderno.json" atomically inside the chosen directory handle', async () => {
    const ws = createSeedWorkspace();
    const writes: string[] = [];
    let closed = false;
    const createWritableMock = vi.fn(async () => ({
      write: async (data: string) => {
        writes.push(data);
      },
      close: async () => {
        closed = true;
      },
    }));
    const getFileHandleMock = vi.fn(async () => ({
      name: BACKUP_FILENAME,
      createWritable: createWritableMock,
    }));

    const handle: BackupDirectoryHandle = {
      name: 'Copias Cuaderno',
      getFileHandle: getFileHandleMock,
    };

    const meta = await writeBackupToDirectory(handle, ws);

    expect(getFileHandleMock).toHaveBeenCalledWith('Mi Cuaderno.json', { create: true });
    expect(createWritableMock).toHaveBeenCalledWith({ keepExistingData: false });
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]).classes).toHaveLength(ws.classes.length);
    expect(closed).toBe(true);
    expect(meta.folderName).toBe('Copias Cuaderno');
    expect(meta.lastBackedUpUpdatedAt).toBe(ws.updatedAt);
    expect(meta.lastSavedAt).toBeTruthy();
  });

  it('checks permissions without prompting when interactive=false and requests when interactive=true', async () => {
    const queryPermission = vi.fn(async () => 'prompt' as const);
    const requestPermission = vi.fn(async () => 'granted' as const);

    const handle: BackupDirectoryHandle = {
      name: 'Descargas',
      getFileHandle: vi.fn(),
      queryPermission,
      requestPermission,
    };

    expect(await queryBackupFolderPermission(handle)).toBe('prompt');
    expect(await ensureBackupFolderPermission(handle, false)).toBe('prompt');
    expect(requestPermission).not.toHaveBeenCalled();

    expect(await ensureBackupFolderPermission(handle, true)).toBe('granted');
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });
});
