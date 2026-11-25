import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  firebaseAuth,
  googleProvider as googleAuthProvider,
  isFirebaseConfigured,
} from '../config/firebase';
import { getGroupDefaultColor } from '../constants/colors';
import {
  DEFAULT_LOMLOE_KEY_COMPETENCES,
  DEFAULT_LOMLOE_RELIGION_CURRICULA,
} from '../data/lomloeReligion';
import { createSeedWorkspace } from '../data/seedData';
import {
  cloneColumnBatch,
  cloneFolderWithColumns,
  cloneSingleColumn,
  cloneTabEntity,
  cloneTabsWithRemappedIds,
  createClassBookFromTemplate,
} from '../engine/cloneHelpers';
import {
  createEducamosDoneTracking,
  markEducamosCellSynced,
} from '../engine/educamos';
import {
  applyCounterDelta,
  clampGradeForColumn,
  computeFolderSourceSignature,
  ensureGroupCategories,
  fillColumnsEmptyWithNP,
  getEffectiveBookGroups,
  makeId,
  normalizeRubricLevels,
  recalculateBook,
  restoreFolderCellsCalculation,
  roundTo,
} from '../engine/gradeMath';
import {
  aspectSnapshotsEqual,
  applyAspectSnapshot,
  captureAspectSnapshot,
  findFirstChangedCellTarget,
  isAspectBookPatch,
  isAspectSettingsPatch,
  preserveCurrentAspectOnDataUndo,
  resolveBookIdAndTabIdForColumn,
  type AspectUndoSnapshot,
  type CellFocusTarget,
  type UndoneCellTarget,
} from '../engine/undoHelpers';
import {
  getCanonicalItemOrder,
  moveItemInTab,
  stepColumnHorizontally,
  stepFolderHorizontally,
  syncTabOrderIndices,
  type DragItemPayload,
  type DropTargetPayload,
} from '../engine/tabLayout';
import {
  mergeWorkspaces3Way,
  preserveDeviceLocalLayoutAndNav,
  type SyncCellConflict,
} from '../engine/syncEngine';
import {
  clearLocalWorkspace,
  hydrateWorkspace,
  loadFirebaseWorkspace,
  loadLocalWorkspace,
  loadLocalWorkspaceSync,
  loadSyncBaseWorkspace,
  loadSyncMeta,
  loadUiMenuPrefs,
  mergeNewerLocalUiPrefs,
  saveFirebaseWorkspace,
  saveLocalWorkspace,
  savePreMergeBackup,
  saveSyncBaseWorkspace,
  saveSyncMeta,
  saveUiMenuPrefs,
  subscribeFirebaseWorkspace,
} from '../services/storage';
import {
  clearBackupDirHandle,
  downloadBackupFile,
  ensureBackupFolderPermission,
  isDirectoryPickerSupported,
  loadBackupDirHandle,
  loadLocalBackupMeta,
  pickBackupFolder,
  queryBackupFolderPermission,
  writeBackupToDirectory,
  type AutoBackupStatus,
  type BackupDirectoryHandle,
} from '../services/localBackup';
import {
  cellKey,
  type ClassBook,
  type ColumnEntity,
  type ColumnSummaryMetric,
  type FolderEntity,
  type GradebookWorkspace,
  type GroupCategoryDef,
  type RubricCellEval,
  type RubricEntity,
  type StudentEntity,
  type StudentGroupDef,
  type TabEntity,
  type ViewSettings,
} from '../types/gradebook';

export type SyncStatus = 'local' | 'offline' | 'syncing' | 'synced' | 'error';

interface GradebookContextValue {
  workspace: GradebookWorkspace;
  activeBook: ClassBook | null;
  activeTab: TabEntity | null;
  isTemplateMode: boolean;

  // Auth & Firebase Sync (Offline-first 3-way merge)
  user: User | null;
  authLoading: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  isOnline: boolean;
  hasPendingSync: boolean;
  syncConflicts: SyncCellConflict[];
  syncNotice: string | null;
  isFirebaseConfigured: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutGoogle: () => Promise<void>;
  pushLocalToCloud: () => Promise<void>;
  reconcileCloudNow: () => Promise<void>;
  resolveSyncConflict: (conflictId: string, choice: 'LOCAL' | 'REMOTE') => void;
  dismissSyncConflicts: () => void;

  // Navigation & Settings
  setActiveMode: (mode: 'CLASS' | 'TEMPLATE') => void;
  selectClass: (classId: string) => void;
  selectTemplate: (templateId: string) => void;
  selectTab: (tabId: string) => void;
  updateSettings: (patch: Partial<ViewSettings>) => void;

  // Data Undo (never affects aspect) & Aspect Undo (separate)
  canUndo: boolean;
  undo: () => void;
  lastUndoneTarget: UndoneCellTarget | null;
  canUndoAspect: boolean;
  undoAspect: () => void;
  beginAspectChange: () => void;

  // Classes & Templates CRUD
  createBook: (
    kind: 'CLASS' | 'TEMPLATE',
    data: { name: string; subject: string; school?: string; year?: string; color: string }
  ) => ClassBook;
  updateBook: (bookId: string, patch: Partial<ClassBook>) => void;
  deleteBook: (bookId: string) => void;
  instantiateTemplateAsClass: (templateId: string, name: string, subject: string, color: string) => void;
  saveBookAsTemplate: (sourceClassId: string, templateName?: string) => ClassBook | null;
  applyTemplateTabsToClass: (templateId: string, targetClassId: string) => void;
  copyColumnToTarget: (
    sourceBookId: string,
    columnId: string,
    targetClassId: string,
    targetTabId: string,
    options?: {
      targetFolderId?: string | null;
      mode?: 'ADD' | 'REPLACE';
      replaceColumnId?: string;
    }
  ) => void;
  copyColumnsToTarget: (
    sourceBookId: string,
    items: Array<{
      columnId: string;
      mode?: 'ADD' | 'REPLACE';
      replaceColumnId?: string;
    }>,
    targetClassId: string,
    targetTabId: string,
    options?: {
      targetFolderId?: string | null;
    }
  ) => void;
  copyFolderToTarget: (
    sourceBookId: string,
    sourceTabId: string,
    folderId: string,
    targetClassId: string,
    targetTabId: string,
    options?: {
      mode?: 'ADD' | 'REPLACE';
      replaceFolderId?: string;
    }
  ) => void;
  copyTabToTarget: (
    sourceBookId: string,
    sourceTabId: string,
    targetClassId: string,
    options?: {
      mode?: 'ADD' | 'REPLACE';
      replaceTabId?: string;
    }
  ) => void;

  // Tabs CRUD & Drag Reorder
  addTab: (title: string, color: string) => TabEntity | null;
  updateTab: (tabId: string, patch: Partial<TabEntity>) => void;
  duplicateTab: (tabId: string, includeGrades: boolean) => void;
  deleteTab: (tabId: string) => void;
  reorderTabs: (draggedTabId: string, targetTabId: string) => void;

  // Folders CRUD
  addFolder: (title: string, color: string) => FolderEntity | null;
  updateFolder: (tabId: string, folderId: string, patch: Partial<FolderEntity>) => void;
  toggleFolderCollapse: (tabId: string, folderId: string) => void;
  deleteFolder: (tabId: string, folderId: string) => void;
  stepFolder: (tabId: string, folderId: string, dir: 'LEFT' | 'RIGHT') => void;
  resizeFolder: (tabId: string, folderId: string, width: number) => void;

  // Columns CRUD, Resize & Drag Reorder
  addColumn: (col: Omit<ColumnEntity, 'id' | 'orderIndex'>) => ColumnEntity | null;
  updateColumn: (columnId: string, patch: Partial<ColumnEntity>) => void;
  deleteColumn: (columnId: string) => void;
  clearColumnCells: (columnId: string) => void;
  duplicateColumn: (columnId: string, includeGrades: boolean) => void;
  resizeColumn: (columnId: string, width: number) => void;
  reorderColumn: (draggedColId: string, targetColId: string, targetFolderId?: string | null) => void;
  moveItemInActiveTab: (drag: DragItemPayload, target: DropTargetPayload) => void;
  stepColumn: (columnId: string, dir: 'LEFT' | 'RIGHT') => void;
  moveColumnToFolder: (columnId: string, folderId: string | null) => void;
  moveColumnToTab: (columnId: string, targetTabId: string) => void;
  applyUniformColumnWidth: (width: number, scope?: 'TAB' | 'BOOK' | 'ALL') => void;
  applyUniformFolderWidth: (width: number, scope?: 'TAB' | 'BOOK') => void;

  // Bottom Summary Rows (up to 5 per column, extensible globally)
  addSummaryRow: (metric: ColumnSummaryMetric) => void;
  updateGlobalSummaryRow: (
    rowIndex: number,
    metric: ColumnSummaryMetric,
    clearColumnOverrides?: boolean
  ) => void;
  removeSummaryRow: (rowIndex: number) => void;
  setColumnSummaryOverride: (
    target: { kind: 'COL'; id: string } | { kind: 'FOLDER'; tabId: string; id: string },
    rowIndex: number,
    metric: ColumnSummaryMetric | null
  ) => void;

  // Per-Group Bottom Summary Rows (up to 5 per group; configuring one configures ALL groups)
  addGroupSummaryRow: (metric: ColumnSummaryMetric) => void;
  updateGlobalGroupSummaryRow: (
    rowIndex: number,
    metric: ColumnSummaryMetric,
    clearColumnOverrides?: boolean
  ) => void;
  removeGroupSummaryRow: (rowIndex: number) => void;
  setColumnGroupSummaryOverride: (
    target: { kind: 'COL'; id: string } | { kind: 'FOLDER'; tabId: string; id: string },
    rowIndex: number,
    metric: ColumnSummaryMetric | null
  ) => void;

  // Students CRUD & Reorder
  addStudent: (data: Omit<StudentEntity, 'id' | 'orderIndex'>) => StudentEntity | null;
  bulkImportStudents: (
    students: Array<{ firstName: string; lastName: string; group?: string }>,
    mode: 'APPEND' | 'REPLACE'
  ) => void;
  updateStudent: (studentId: string, patch: Partial<StudentEntity>) => void;
  deleteStudent: (studentId: string) => void;
  reorderStudents: (
    orderedIds: string[],
    groupReassignment?: { studentId: string; group?: string }
  ) => void;

  // Student Groups & Categories CRUD & Assignment
  createGroupCategory: (name: string) => GroupCategoryDef | null;
  renameGroupCategory: (categoryId: string, name: string) => void;
  deleteGroupCategory: (categoryId: string) => void;
  selectGroupCategory: (categoryId: string) => void;
  upsertStudentGroup: (name: string, color?: string, previousName?: string) => void;
  deleteStudentGroup: (groupName: string) => void;
  reorderStudentGroups: (orderedNames: string[]) => void;
  assignStudentsToGroup: (studentIds: string[], groupName?: string) => void;
  toggleGroupCollapsed: (groupKey: string) => void;

  // Cells
  setCellData: (
    studentId: string,
    columnId: string,
    grade: number | null,
    comment: string,
    options?: {
      preserveExistingGrade?: boolean;
      preserveExistingComment?: boolean;
      clearPendingAdjustment?: boolean;
    }
  ) => void;
  setMultipleCellsData: (
    targets: Array<{ studentId: string; columnId: string }>,
    grade: number | null,
    comment: string,
    options?: { preserveExistingGrade?: boolean; preserveExistingComment?: boolean }
  ) => void;
  applyCellsBatch: (
    entries: Array<{
      studentId: string;
      columnId: string;
      grade: number | null;
      comment: string;
      pendingAdjustment?: number;
      appliedAdjustment?: number;
      preAdjustmentGrade?: number;
      keepRubricAuto?: boolean;
      hasExplicitPendingAdjustment?: boolean;
    }>
  ) => void;
  restoreOriginalGrades: (targets: Array<{ studentId: string; columnId: string }>) => void;
  setCellRubricEval: (
    studentId: string,
    columnId: string,
    rubricEval: RubricCellEval,
    comment?: string,
    preserveManualOverride?: boolean
  ) => void;
  toggleColumnRubricExpanded: (columnId: string) => void;
  setRubricCriterionForStudents: (
    studentIds: string[],
    columnId: string,
    rubricId: string,
    criterionId: string,
    levelId: string | null
  ) => void;
  setRubricEvalForStudents: (
    studentIds: string[],
    columnId: string,
    rubricId: string,
    selections: RubricCellEval['selections'],
    options?: {
      comment?: string;
      touchedCriteriaIds?: string[];
    }
  ) => void;
  clearCell: (studentId: string, columnId: string) => void;
  clearMultipleCells: (targets: Array<{ studentId: string; columnId: string }>) => void;
  fillEmptyGradesWithNP: (columnIds: string[]) => {
    filledCount: number;
    affectedColumnCount: number;
  };
  restoreFolderCellCalculation: (studentId: string, folderId: string) => void;
  restoreFolderCalculation: (folderId: string) => number;
  recalculateActiveBook: () => void;

  // Rubrics CRUD
  saveRubric: (rubric: RubricEntity) => RubricEntity;
  deleteRubric: (rubricId: string) => void;

  // LOMLOE Curricula & Criteria
  setColumnLomloeCriteria: (columnId: string, criteriaIds: string[]) => void;
  saveLomloeCurriculum: (curriculum: import('../types/gradebook').LomloeCurriculum) => void;
  deleteLomloeCurriculum: (curriculumId: string) => void;
  resetDefaultLomloeCurricula: () => void;
  updateLomloeKeyCompetences: (
    competences: import('../types/gradebook').LomloeKeyCompetenceDef[]
  ) => void;

  // Educamos tracking
  setColumnEducamosStatus: (columnId: string, status: 'PENDING' | 'DONE') => void;
  markCellEducamosUpdated: (studentId: string, columnId: string) => void;

  // Demo, Backup & Reset
  autoBackup: {
    supported: boolean;
    status: AutoBackupStatus;
    folderName: string | null;
    lastSavedAt: string | null;
    error: string | null;
  };
  configureAutoBackupFolder: () => Promise<boolean>;
  reactivateAutoBackup: () => Promise<boolean>;
  disableAutoBackupFolder: () => Promise<void>;
  saveManualBackup: () => Promise<'FOLDER' | 'DOWNLOAD'>;
  loadDemoData: () => void;
  restoreBackup: (backup: GradebookWorkspace) => void;
  resetAll: () => void;
}

const GradebookContext = createContext<GradebookContextValue | null>(null);

export const GradebookProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialLocalSync = useRef<GradebookWorkspace | null | undefined>(undefined);
  if (initialLocalSync.current === undefined) {
    initialLocalSync.current = loadLocalWorkspaceSync();
  }
  const [workspace, setWorkspace] = useState<GradebookWorkspace>(() => {
    const base =
      initialLocalSync.current && initialLocalSync.current.classes.length > 0
        ? initialLocalSync.current
        : createSeedWorkspace();
    return mergeNewerLocalUiPrefs(base, loadUiMenuPrefs()).workspace;
  });
  const [hydrated, setHydrated] = useState(() =>
    Boolean(initialLocalSync.current && initialLocalSync.current.classes.length > 0)
  );
  const [undoStack, setUndoStack] = useState<
    Array<{ workspace: GradebookWorkspace; focusCell: CellFocusTarget | null }>
  >([]);
  const undoStackRef = useRef<
    Array<{ workspace: GradebookWorkspace; focusCell: CellFocusTarget | null }>
  >([]);
  undoStackRef.current = undoStack;

  const [aspectUndoStack, setAspectUndoStack] = useState<AspectUndoSnapshot[]>([]);
  const aspectUndoStackRef = useRef<AspectUndoSnapshot[]>([]);
  aspectUndoStackRef.current = aspectUndoStack;
  const aspectTxBeforeRef = useRef<AspectUndoSnapshot | null>(null);

  const [lastUndoneTarget, setLastUndoneTarget] = useState<UndoneCellTarget | null>(null);
  const undoneSeqRef = useRef(0);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(isFirebaseConfigured);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [hasPendingSync, setHasPendingSync] = useState<boolean>(
    () => loadSyncMeta().hasPendingLocalChanges
  );
  const [syncConflicts, setSyncConflicts] = useState<SyncCellConflict[]>([]);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'local'
  );
  const [syncError, setSyncError] = useState<string | null>(null);

  const cloudWriteTimer = useRef<number | null>(null);
  const pendingCloudUserRef = useRef<string | null>(null);
  const lastRemoteUpdatedAtRef = useRef<string | null>(null);
  const lastWrittenUpdatedAtRef = useRef<string | null>(null);
  const cloudReadyRef = useRef(false);
  const reconcilingRef = useRef(false);
  const dataMutationSeqRef = useRef(0);
  const lastCloudHandledDataSeqRef = useRef(0);
  const userRef = useRef<User | null>(null);
  userRef.current = user;
  const workspaceRef = useRef<GradebookWorkspace>(workspace);
  workspaceRef.current = workspace;

  const initialBackupMeta = useMemo(() => loadLocalBackupMeta(), []);
  const backupDirHandleRef = useRef<BackupDirectoryHandle | null>(null);
  const lastBackedUpUpdatedAtRef = useRef<string | null>(initialBackupMeta.lastBackedUpUpdatedAt);
  const autoBackupTimerRef = useRef<number | null>(null);
  const [autoBackup, setAutoBackup] = useState<GradebookContextValue['autoBackup']>(() => ({
    supported: isDirectoryPickerSupported(),
    status: isDirectoryPickerSupported()
      ? initialBackupMeta.folderName
        ? 'NEEDS_PERMISSION'
        : 'UNCONFIGURED'
      : 'UNSUPPORTED',
    folderName: initialBackupMeta.folderName,
    lastSavedAt: initialBackupMeta.lastSavedAt,
    error: null,
  }));

  const markLocalDirty = useCallback(() => {
    const prevMeta = loadSyncMeta();
    if (!prevMeta.hasPendingLocalChanges) {
      saveSyncMeta({
        ...prevMeta,
        hasPendingLocalChanges: true,
        pendingSince: new Date().toISOString(),
      });
    }
    setHasPendingSync(true);
  }, []);

  const markCloudSynced = useCallback((uid: string, syncedWs: GradebookWorkspace) => {
    saveSyncMeta({
      lastSyncedAt: syncedWs.updatedAt,
      lastSyncedUid: uid,
      hasPendingLocalChanges: false,
      pendingSince: null,
    });
    setHasPendingSync(false);
    void saveSyncBaseWorkspace(syncedWs);
  }, []);

  /**
   * Safe 3-way reconciliation between local workspace (possibly edited offline) and cloud workspace.
   * Never silently wipes out offline grades: merges per-book, per-column, per-student & per-cell.
   */
  const reconcileWithCloud = useCallback(
    async (uid: string, incomingRemote?: GradebookWorkspace | null) => {
      if (!isFirebaseConfigured || reconcilingRef.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        return;
      }
      reconcilingRef.current = true;
      setSyncStatus('syncing');
      try {
        const remote =
          incomingRemote !== undefined ? incomingRemote : await loadFirebaseWorkspace(uid);
        const localLatest = workspaceRef.current;
        const meta = loadSyncMeta();
        const sameAccount = !meta.lastSyncedUid || meta.lastSyncedUid === uid;
        const localHasPending = meta.hasPendingLocalChanges && sameAccount;

        if (remote && remote.classes.length > 0) {
          if (localHasPending) {
            // Fast path: remote did not change since our last sync -> upload local directly
            if (meta.lastSyncedAt && remote.updatedAt === meta.lastSyncedAt) {
              lastWrittenUpdatedAtRef.current = localLatest.updatedAt;
              lastRemoteUpdatedAtRef.current = localLatest.updatedAt;
              await saveFirebaseWorkspace(uid, localLatest);
              await saveLocalWorkspace(localLatest);
              markCloudSynced(uid, localLatest);
              setSyncNotice('Cambios realizados sin conexión sincronizados en la nube.');
            } else {
              // Both devices edited -> 3-way semantic merge preserving both sides!
              const baseWs = await loadSyncBaseWorkspace();
              await savePreMergeBackup(localLatest);
              const merged = mergeWorkspaces3Way(baseWs, localLatest, remote);
              lastWrittenUpdatedAtRef.current = merged.workspace.updatedAt;
              lastRemoteUpdatedAtRef.current = merged.workspace.updatedAt;
              lastCloudHandledDataSeqRef.current = dataMutationSeqRef.current;
              workspaceRef.current = merged.workspace;
              setWorkspace(merged.workspace);
              await saveLocalWorkspace(merged.workspace);
              await saveFirebaseWorkspace(uid, merged.workspace);
              markCloudSynced(uid, merged.workspace);

              if (merged.cellConflicts.length > 0) {
                setSyncConflicts(merged.cellConflicts);
                setSyncNotice(
                  `Fusión completada con ${merged.cellConflicts.length} celda(s) editadas en dos dispositivos. Puedes revisarlas en Cuenta y Sincronización.`
                );
              } else if (merged.hadDivergence) {
                setSyncNotice(
                  'Cambios sin conexión combinados automáticamente con los de tus otros dispositivos sin perder ningún dato.'
                );
              }
            }
          } else {
            // No pending local edits -> accept remote DATA only while keeping 100% of device-local aspect, widths & active screens
            const deviceSafeWs = preserveDeviceLocalLayoutAndNav(remote, localLatest);
            lastRemoteUpdatedAtRef.current = remote.updatedAt;
            lastWrittenUpdatedAtRef.current = remote.updatedAt;
            lastCloudHandledDataSeqRef.current = dataMutationSeqRef.current;
            workspaceRef.current = deviceSafeWs;
            setWorkspace(deviceSafeWs);
            await saveLocalWorkspace(deviceSafeWs);
            markCloudSynced(uid, remote);
          }
        } else {
          // Remote branch is empty (first sign-in): upload local workspace
          const toUpload = (await loadLocalWorkspace()) ?? localLatest;
          lastWrittenUpdatedAtRef.current = toUpload.updatedAt;
          lastRemoteUpdatedAtRef.current = toUpload.updatedAt;
          workspaceRef.current = toUpload;
          setWorkspace(toUpload);
          await saveFirebaseWorkspace(uid, toUpload);
          markCloudSynced(uid, toUpload);
        }

        cloudReadyRef.current = true;
        setSyncStatus('synced');
        setSyncError(null);
      } catch (err) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setSyncStatus('offline');
          setSyncError(null);
        } else {
          setSyncStatus('error');
          setSyncError(err instanceof Error ? err.message : 'Error de sincronización');
        }
      } finally {
        reconcilingRef.current = false;
      }
    },
    [markCloudSynced]
  );

  // Track online / offline connectivity & auto-reconcile pending offline changes when reconnected or resumed
  useEffect(() => {
    let lastResumeCheck = 0;
    const handleOnline = () => {
      setIsOnline(true);
      if (userRef.current && isFirebaseConfigured) {
        void reconcileWithCloud(userRef.current.uid);
      } else {
        setSyncStatus('local');
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus('offline');
      setSyncError(null);
    };
    const handleWakeSync = () => {
      if (document.visibilityState !== 'visible') return;
      if (!navigator.onLine || !userRef.current || !isFirebaseConfigured || !cloudReadyRef.current) return;
      const now = Date.now();
      if (now - lastResumeCheck < 4_000) return;
      lastResumeCheck = now;
      void reconcileWithCloud(userRef.current.uid);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleWakeSync);
    document.addEventListener('visibilitychange', handleWakeSync);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleWakeSync);
      document.removeEventListener('visibilitychange', handleWakeSync);
    };
  }, [reconcileWithCloud]);

  // Hydrate offline IDB workspace fallback when synchronous localStorage had no workspace
  useEffect(() => {
    if (hydrated) return;
    let alive = true;
    loadLocalWorkspace().then((local) => {
      if (!alive) return;
      if (local && local.classes.length > 0) {
        const next = mergeNewerLocalUiPrefs(local, loadUiMenuPrefs()).workspace;
        setWorkspace(next);
        workspaceRef.current = next;
      }
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [hydrated]);

  // Optional Firebase Auth + Realtime Sync (with iOS Standalone redirect completion + offline 3-way merge)
  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseAuth) {
      setAuthLoading(false);
      setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'local');
      return;
    }

    // Complete any pending OAuth redirect (used automatically on iPadOS/iOS standalone PWAs)
    void getRedirectResult(firebaseAuth).catch(() => {
      // ignore if no pending redirect
    });

    let unsubDb: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      cloudReadyRef.current = false;
      lastRemoteUpdatedAtRef.current = null;
      lastWrittenUpdatedAtRef.current = null;
      setUser(nextUser);
      setAuthLoading(false);

      if (unsubDb) {
        unsubDb();
        unsubDb = null;
      }

      if (!nextUser) {
        setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'local');
        setSyncError(null);
        return;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        return;
      }

      await reconcileWithCloud(nextUser.uid);

      unsubDb = subscribeFirebaseWorkspace(
        nextUser.uid,
        (remoteWs) => {
          // Ignore echoes of our own writes or identical snapshots
          if (
            remoteWs.updatedAt === lastWrittenUpdatedAtRef.current ||
            remoteWs.updatedAt === lastRemoteUpdatedAtRef.current
          ) {
            return;
          }
          void reconcileWithCloud(nextUser.uid, remoteWs);
        },
        (err) => {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setSyncStatus('offline');
          } else {
            setSyncStatus('error');
            setSyncError(err.message);
          }
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubDb) unsubDb();
    };
  }, [reconcileWithCloud]);

  // Save locally & debounce cloud sync (plus flush on pagehide / visibilitychange)
  useEffect(() => {
    if (!hydrated) return;
    saveLocalWorkspace(workspace);

    if (user && isFirebaseConfigured) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        return;
      }
      if (!cloudReadyRef.current) return;

      // Skip cloud write-back when state was just applied from RTDB or when only local UI/aspect changed
      if (
        dataMutationSeqRef.current === lastCloudHandledDataSeqRef.current ||
        workspace.updatedAt === lastRemoteUpdatedAtRef.current ||
        workspace.updatedAt === lastWrittenUpdatedAtRef.current
      ) {
        return;
      }

      if (cloudWriteTimer.current) window.clearTimeout(cloudWriteTimer.current);
      setSyncStatus('syncing');
      const snapshot = workspace;
      const snapshotDataSeq = dataMutationSeqRef.current;
      pendingCloudUserRef.current = user.uid;
      cloudWriteTimer.current = window.setTimeout(async () => {
        cloudWriteTimer.current = null;
        pendingCloudUserRef.current = null;
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setSyncStatus('offline');
          return;
        }
        try {
          lastWrittenUpdatedAtRef.current = snapshot.updatedAt;
          lastRemoteUpdatedAtRef.current = snapshot.updatedAt;
          lastCloudHandledDataSeqRef.current = snapshotDataSeq;
          await saveFirebaseWorkspace(user.uid, snapshot);
          markCloudSynced(user.uid, snapshot);
          setSyncStatus('synced');
          setSyncError(null);
        } catch (err) {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setSyncStatus('offline');
            setSyncError(null);
          } else {
            setSyncStatus('error');
            setSyncError(err instanceof Error ? err.message : 'Error al guardar en la nube');
          }
        }
      }, 400);
    }
  }, [workspace, hydrated, user, markCloudSynced]);

  useEffect(() => {
    const flushNow = () => {
      const latest = workspaceRef.current;
      saveUiMenuPrefs(latest);
      if (cloudWriteTimer.current && pendingCloudUserRef.current) {
        window.clearTimeout(cloudWriteTimer.current);
        cloudWriteTimer.current = null;
        const uid = pendingCloudUserRef.current;
        pendingCloudUserRef.current = null;
        lastWrittenUpdatedAtRef.current = latest.updatedAt;
        void saveFirebaseWorkspace(uid, latest)
          .then(() => {
            markCloudSynced(uid, latest);
          })
          .catch(() => {
            // Keep pending local marker so next reconnect/resume reconciles cleanly
          });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [markCloudSynced]);

  const isTemplateMode = workspace.activeMode === 'TEMPLATE';

  const activeBook = useMemo(() => {
    if (isTemplateMode) {
      return (
        workspace.templates.find((t) => t.id === workspace.activeTemplateId) ??
        workspace.templates[0] ??
        null
      );
    }
    return (
      workspace.classes.find((c) => c.id === workspace.activeClassId) ??
      workspace.classes[0] ??
      null
    );
  }, [workspace, isTemplateMode]);

  const activeTab = useMemo(() => {
    if (!activeBook) return null;
    const savedId = workspace.activeTabByBook[activeBook.id];
    const sorted = [...activeBook.tabs].sort((a, b) => a.orderIndex - b.orderIndex);
    return sorted.find((t) => t.id === savedId) ?? sorted[0] ?? null;
  }, [activeBook, workspace.activeTabByBook]);

  const pushAspectUndo = useCallback((snapshot: AspectUndoSnapshot) => {
    const next = [...aspectUndoStackRef.current.slice(-39), snapshot];
    aspectUndoStackRef.current = next;
    setAspectUndoStack(next);
  }, []);

  const beginAspectChange = useCallback(() => {
    if (aspectTxBeforeRef.current) return;
    aspectTxBeforeRef.current = captureAspectSnapshot(workspaceRef.current);
    const finishTx = () => {
      const before = aspectTxBeforeRef.current;
      aspectTxBeforeRef.current = null;
      if (!before) return;
      const after = captureAspectSnapshot(workspaceRef.current);
      if (!aspectSnapshotsEqual(before, after)) {
        pushAspectUndo(before);
      }
    };
    window.addEventListener('pointerup', finishTx, { once: true });
    window.addEventListener('pointercancel', finishTx, { once: true });
  }, [pushAspectUndo]);

  const commit = useCallback(
    (
      updater: (prev: GradebookWorkspace) => GradebookWorkspace,
      recordUndo = true,
      focusHint?: { studentId: string; columnId: string } | null
    ) => {
      const prev = workspaceRef.current;
      const nextRaw = updater(prev);
      const nextWs = recordUndo
        ? {
            ...nextRaw,
            updatedAt: new Date().toISOString(),
          }
        : {
            ...nextRaw,
            updatedAt: prev.updatedAt,
          };
      if (recordUndo) {
        let resolvedFocus: CellFocusTarget | null = null;
        if (focusHint) {
          const loc = resolveBookIdAndTabIdForColumn(prev, focusHint.columnId);
          if (loc) {
            resolvedFocus = {
              bookId: loc.bookId,
              tabId: loc.tabId,
              studentId: focusHint.studentId,
              columnId: focusHint.columnId,
            };
          }
        }
        const nextUndo = [
          ...undoStackRef.current.slice(-39),
          { workspace: prev, focusCell: resolvedFocus },
        ];
        undoStackRef.current = nextUndo;
        setUndoStack(nextUndo);
        dataMutationSeqRef.current += 1;
        markLocalDirty();
      }
      workspaceRef.current = nextWs;
      setWorkspace(nextWs);
    },
    [markLocalDirty]
  );

  const mutateActiveBook = useCallback(
    (
      mutator: (book: ClassBook, ws: GradebookWorkspace) => ClassBook,
      recordUndo = true,
      focusHint?: { studentId: string; columnId: string } | null
    ) => {
      commit(
        (prev) => {
          if (prev.activeMode === 'TEMPLATE') {
            const targetId = prev.activeTemplateId ?? prev.templates[0]?.id;
            if (!targetId) return prev;
            return {
              ...prev,
              templates: prev.templates.map((t) => (t.id === targetId ? mutator(t, prev) : t)),
            };
          }
          const targetId = prev.activeClassId ?? prev.classes[0]?.id;
          if (!targetId) return prev;
          return {
            ...prev,
            classes: prev.classes.map((c) => (c.id === targetId ? mutator(c, prev) : c)),
          };
        },
        recordUndo,
        focusHint
      );
    },
    [commit]
  );

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    const nextStack = stack.slice(0, -1);
    undoStackRef.current = nextStack;
    setUndoStack(nextStack);

    const currentWs = workspaceRef.current;
    // Always preserve current aspect settings/widths on Data Undo
    const restored = preserveCurrentAspectOnDataUndo(entry.workspace, currentWs);
    const resolvedTarget =
      entry.focusCell ?? findFirstChangedCellTarget(currentWs, restored);

    let finalWs: GradebookWorkspace = {
      ...restored,
      updatedAt: new Date().toISOString(),
    };

    if (resolvedTarget) {
      const isTpl = finalWs.templates.some((t) => t.id === resolvedTarget.bookId);
      const bookExists = isTpl || finalWs.classes.some((c) => c.id === resolvedTarget.bookId);
      if (bookExists) {
        finalWs = {
          ...finalWs,
          activeMode: isTpl ? 'TEMPLATE' : 'CLASS',
          activeClassId: isTpl ? finalWs.activeClassId : resolvedTarget.bookId,
          activeTemplateId: isTpl ? resolvedTarget.bookId : finalWs.activeTemplateId,
          activeTabByBook: resolvedTarget.tabId
            ? { ...finalWs.activeTabByBook, [resolvedTarget.bookId]: resolvedTarget.tabId }
            : finalWs.activeTabByBook,
        };
      }
    }

    dataMutationSeqRef.current += 1;
    workspaceRef.current = finalWs;
    setWorkspace(finalWs);
    markLocalDirty();

    if (resolvedTarget) {
      undoneSeqRef.current += 1;
      setLastUndoneTarget({ ...resolvedTarget, seq: undoneSeqRef.current });
    }
  }, [markLocalDirty]);

  const undoAspect = useCallback(() => {
    aspectTxBeforeRef.current = null;
    const stack = aspectUndoStackRef.current;
    if (stack.length === 0) return;
    const snapshot = stack[stack.length - 1];
    const nextStack = stack.slice(0, -1);
    aspectUndoStackRef.current = nextStack;
    setAspectUndoStack(nextStack);
    commit((prev) => applyAspectSnapshot(prev, snapshot), false);
  }, [commit]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!firebaseAuth) return;
    await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!firebaseAuth) return;
    await sendPasswordResetEmail(firebaseAuth, email.trim());
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!firebaseAuth || !googleAuthProvider) return;
    const isStandalonePwa =
      typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((window.navigator as { standalone?: boolean }).standalone));
    const isIosUa =
      typeof navigator !== 'undefined' &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

    if (isStandalonePwa && isIosUa) {
      await signInWithRedirect(firebaseAuth, googleAuthProvider);
      return;
    }
    try {
      await signInWithPopup(firebaseAuth, googleAuthProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(firebaseAuth, googleAuthProvider);
      } else {
        throw err;
      }
    }
  }, []);

  const signOutGoogle = useCallback(async () => {
    if (!firebaseAuth) return;
    await signOut(firebaseAuth);
  }, []);

  const pushLocalToCloud = useCallback(async () => {
    if (!user || !isFirebaseConfigured) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSyncStatus('offline');
      return;
    }
    setSyncStatus('syncing');
    try {
      const latest = workspaceRef.current;
      lastWrittenUpdatedAtRef.current = latest.updatedAt;
      lastRemoteUpdatedAtRef.current = latest.updatedAt;
      await saveFirebaseWorkspace(user.uid, latest);
      markCloudSynced(user.uid, latest);
      setSyncStatus('synced');
      setSyncError(null);
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err instanceof Error ? err.message : 'Error al sincronizar');
    }
  }, [user, markCloudSynced]);

  const reconcileCloudNow = useCallback(async () => {
    if (!userRef.current || !isFirebaseConfigured) return;
    await reconcileWithCloud(userRef.current.uid);
  }, [reconcileWithCloud]);

  const resolveSyncConflict = useCallback(
    (conflictId: string, choice: 'LOCAL' | 'REMOTE') => {
      const target = syncConflicts.find((c) => c.id === conflictId);
      if (!target) return;
      commit((prev) => {
        const applyToBook = (b: ClassBook): ClassBook => {
          if (b.id !== target.bookId) return b;
          const k = cellKey(target.studentId, target.columnId);
          const nextCells = { ...b.cells };
          const chosenCell = choice === 'LOCAL' ? target.localCell : target.remoteCell;
          if (chosenCell) {
            nextCells[k] = chosenCell;
          } else {
            delete nextCells[k];
          }
          return recalculateBook({ ...b, cells: nextCells }, prev.rubrics);
        };
        return {
          ...prev,
          classes: prev.classes.map(applyToBook),
          templates: prev.templates.map(applyToBook),
        };
      }, true);
      setSyncConflicts((prev) => prev.filter((c) => c.id !== conflictId));
    },
    [syncConflicts, commit]
  );

  const dismissSyncConflicts = useCallback(() => {
    setSyncConflicts([]);
    setSyncNotice(null);
  }, []);

  const setActiveMode = useCallback(
    (mode: 'CLASS' | 'TEMPLATE') => {
      commit(
        (prev) => ({
          ...prev,
          activeMode: mode,
          activeClassId: prev.activeClassId ?? prev.classes[0]?.id ?? null,
          activeTemplateId: prev.activeTemplateId ?? prev.templates[0]?.id ?? null,
        }),
        false
      );
    },
    [commit]
  );

  const selectClass = useCallback(
    (classId: string) => {
      commit((prev) => ({ ...prev, activeMode: 'CLASS', activeClassId: classId }), false);
    },
    [commit]
  );

  const selectTemplate = useCallback(
    (templateId: string) => {
      commit((prev) => ({ ...prev, activeMode: 'TEMPLATE', activeTemplateId: templateId }), false);
    },
    [commit]
  );

  const selectTab = useCallback(
    (tabId: string) => {
      commit((prev) => {
        const bookId =
          prev.activeMode === 'TEMPLATE'
            ? (prev.activeTemplateId ?? prev.templates[0]?.id)
            : (prev.activeClassId ?? prev.classes[0]?.id);
        if (!bookId) return prev;
        return {
          ...prev,
          activeTabByBook: { ...prev.activeTabByBook, [bookId]: tabId },
        };
      }, false);
    },
    [commit]
  );

  const updateSettings = useCallback(
    (patch: Partial<ViewSettings>) => {
      if (isAspectSettingsPatch(patch) && !aspectTxBeforeRef.current) {
        const before = captureAspectSnapshot(workspaceRef.current);
        commit((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }), false);
        const after = captureAspectSnapshot(workspaceRef.current);
        if (!aspectSnapshotsEqual(before, after)) {
          pushAspectUndo(before);
        }
        return;
      }
      commit((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }), false);
    },
    [commit, pushAspectUndo]
  );

  // One-time device migration: compact default cell grade font size (15 px -> 12.5 px)
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    const key = 'cuaderno_grade_font_default_v2';
    try {
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1');
      if (workspaceRef.current.settings.gradeFontSize === 15) {
        commit(
          (prev) => ({
            ...prev,
            settings: { ...prev.settings, gradeFontSize: 12.5 },
          }),
          false
        );
      }
    } catch {
      // ignore storage errors
    }
  }, [hydrated, commit]);

const DEFAULT_GLOBAL_SUMMARY_ROWS: ColumnSummaryMetric[] = ['MEAN', 'PASS_PCT'];

function resolveGlobalSummaryRows(ws: GradebookWorkspace): ColumnSummaryMetric[] {
  if (ws.settings.globalSummaryRows) {
    return [...ws.settings.globalSummaryRows];
  }
  const currentId =
    ws.activeMode === 'TEMPLATE'
      ? (ws.activeTemplateId ?? ws.templates[0]?.id)
      : (ws.activeClassId ?? ws.classes[0]?.id);
  const active =
    ws.classes.find((c) => c.id === currentId) ??
    ws.templates.find((t) => t.id === currentId) ??
    ws.classes[0];
  return [...(active?.summaryRows ?? DEFAULT_GLOBAL_SUMMARY_ROWS)];
}

  const createBook = useCallback<GradebookContextValue['createBook']>(
    (kind, data) => {
      const isTpl = kind === 'TEMPLATE';
      const bookId = makeId(isTpl ? 'tpl' : 'cls');
      const tabId = makeId('tab');
      const colId = makeId('col');

      const newBook: ClassBook = {
        id: bookId,
        name: data.name.trim() || (isTpl ? 'Nueva Plantilla' : 'Nueva Clase'),
        subject: data.subject.trim() || (isTpl ? 'Borrador reutilizable' : 'Asignatura'),
        school: !isTpl && data.school?.trim() ? data.school.trim() : undefined,
        year: data.year?.trim() || (isTpl ? 'Plantilla' : '2026-2027'),
        color: data.color || '#3B82F6',
        passThreshold: 5,
        sortMode: 'LAST_ASC',
        isTemplate: isTpl,
        students: isTpl
          ? [
              {
                id: makeId('st'),
                firstName: 'Alumno',
                lastName: 'Modelo 1',
                group: 'Modelo',
                tags: [],
                orderIndex: 0,
              },
            ]
          : [],
        tabs: [
          {
            id: tabId,
            title: isTpl ? 'Evaluación Modelo' : '1.ª Evaluación',
            color: '#DBEAFE',
            orderIndex: 0,
            folders: [],
            columns: [
              {
                id: colId,
                folderId: null,
                title: 'Actividad 1',
                color: '#DBEAFE',
                width: 80,
                orderIndex: 0,
                type: 'NUMERIC',
                minValue: 0,
                maxValue: 10,
                decimals: 2,
                passThreshold: 5,
                colorMode: 'CELL_BG',
              },
            ],
          },
        ],
        cells: {},
      };

      commit((prev) => {
        const syncedNewBook: ClassBook = {
          ...newBook,
          summaryRows: resolveGlobalSummaryRows(prev),
        };
        return {
          ...prev,
          activeMode: kind,
          activeClassId: isTpl ? prev.activeClassId : bookId,
          activeTemplateId: isTpl ? bookId : prev.activeTemplateId,
          activeTabByBook: { ...prev.activeTabByBook, [bookId]: tabId },
          classes: isTpl ? prev.classes : [...prev.classes, syncedNewBook],
          templates: isTpl ? [...prev.templates, syncedNewBook] : prev.templates,
        };
      });
      return newBook;
    },
    [commit]
  );

  const updateBook = useCallback<GradebookContextValue['updateBook']>(
    (bookId, patch) => {
      if (isAspectBookPatch(patch)) {
        const before = !aspectTxBeforeRef.current ? captureAspectSnapshot(workspaceRef.current) : null;
        commit(
          (prev) => ({
            ...prev,
            classes: prev.classes.map((c) => (c.id === bookId ? { ...c, ...patch } : c)),
            templates: prev.templates.map((t) => (t.id === bookId ? { ...t, ...patch } : t)),
          }),
          false
        );
        if (before) {
          const after = captureAspectSnapshot(workspaceRef.current);
          if (!aspectSnapshotsEqual(before, after)) pushAspectUndo(before);
        }
        return;
      }
      commit((prev) => ({
        ...prev,
        classes: prev.classes.map((c) => (c.id === bookId ? { ...c, ...patch } : c)),
        templates: prev.templates.map((t) => (t.id === bookId ? { ...t, ...patch } : t)),
      }));
    },
    [commit, pushAspectUndo]
  );

  const deleteBook = useCallback<GradebookContextValue['deleteBook']>(
    (bookId) => {
      commit((prev) => {
        const isCls = prev.classes.some((c) => c.id === bookId);
        if (isCls) {
          if (prev.classes.length <= 1) return prev;
          const remaining = prev.classes.filter((c) => c.id !== bookId);
          return {
            ...prev,
            classes: remaining,
            activeClassId:
              prev.activeClassId === bookId ? (remaining[0]?.id ?? null) : prev.activeClassId,
          };
        }
        const remainingTpl = prev.templates.filter((t) => t.id !== bookId);
        return {
          ...prev,
          templates: remainingTpl,
          activeTemplateId:
            prev.activeTemplateId === bookId
              ? (remainingTpl[0]?.id ?? null)
              : prev.activeTemplateId,
          activeMode:
            prev.activeMode === 'TEMPLATE' && remainingTpl.length === 0 ? 'CLASS' : prev.activeMode,
        };
      });
    },
    [commit]
  );

  const instantiateTemplateAsClass = useCallback<
    GradebookContextValue['instantiateTemplateAsClass']
  >(
    (templateId, name, subject, color) => {
      const tpl = workspace.templates.find((t) => t.id === templateId);
      if (!tpl) return;
      const newCls = createClassBookFromTemplate(tpl, name, subject, color);
      commit((prev) => ({
        ...prev,
        activeMode: 'CLASS',
        activeClassId: newCls.id,
        activeTabByBook: { ...prev.activeTabByBook, [newCls.id]: newCls.tabs[0]?.id ?? '' },
        classes: [...prev.classes, { ...newCls, summaryRows: resolveGlobalSummaryRows(prev) }],
      }));
    },
    [workspace.templates, commit]
  );

  const saveBookAsTemplate = useCallback<GradebookContextValue['saveBookAsTemplate']>(
    (sourceClassId, templateName) => {
      const src = workspace.classes.find((c) => c.id === sourceClassId);
      if (!src) return null;
      const tpl: ClassBook = {
        id: makeId('tpl'),
        name: templateName?.trim() || `Plantilla: ${src.name}`,
        subject: src.subject,
        year: 'Plantilla',
        color: src.color,
        passThreshold: src.passThreshold,
        sortMode: src.sortMode,
        isTemplate: true,
        students: [
          {
            id: makeId('st'),
            firstName: 'Alumno',
            lastName: 'Modelo 1',
            group: 'Modelo',
            tags: [],
            orderIndex: 0,
          },
        ],
        tabs: cloneTabsWithRemappedIds(src.tabs),
        cells: {},
      };
      commit((prev) => ({
        ...prev,
        activeMode: 'TEMPLATE',
        activeTemplateId: tpl.id,
        activeTabByBook: { ...prev.activeTabByBook, [tpl.id]: tpl.tabs[0]?.id ?? '' },
        templates: [...prev.templates, { ...tpl, summaryRows: resolveGlobalSummaryRows(prev) }],
      }));
      return tpl;
    },
    [workspace.classes, commit]
  );

  const applyTemplateTabsToClass = useCallback<GradebookContextValue['applyTemplateTabsToClass']>(
    (templateId, targetClassId) => {
      commit((prev) => {
        const tpl = prev.templates.find((t) => t.id === templateId);
        const target = prev.classes.find((c) => c.id === targetClassId);
        if (!tpl || !target) return prev;
        const clonedTabs = cloneTabsWithRemappedIds(tpl.tabs).map((t, i) => ({
          ...t,
          orderIndex: target.tabs.length + i,
        }));
        const nextBook = recalculateBook(
          { ...target, tabs: [...target.tabs, ...clonedTabs] },
          prev.rubrics
        );
        return {
          ...prev,
          activeMode: 'CLASS',
          activeClassId: targetClassId,
          activeTabByBook: {
            ...prev.activeTabByBook,
            [targetClassId]: clonedTabs[0]?.id ?? prev.activeTabByBook[targetClassId],
          },
          classes: prev.classes.map((c) => (c.id === targetClassId ? nextBook : c)),
        };
      });
    },
    [commit]
  );

  const copyColumnToTarget = useCallback<GradebookContextValue['copyColumnToTarget']>(
    (sourceBookId, columnId, targetClassId, targetTabId, options) => {
      commit((prev) => {
        const srcBook =
          prev.classes.find((c) => c.id === sourceBookId) ??
          prev.templates.find((t) => t.id === sourceBookId);
        const srcCol = srcBook?.tabs.flatMap((t) => t.columns).find((c) => c.id === columnId);
        if (!srcCol) return prev;

        const mode = options?.mode ?? 'ADD';
        const replaceId = mode === 'REPLACE' ? options?.replaceColumnId : undefined;

        const mutateBook = (book: ClassBook): ClassBook => {
          if (book.id !== targetClassId) return book;

          let nextCells = { ...book.cells };
          let createdColId: string | null = null;

          let nextTabs = book.tabs.map((tab) => {
            if (tab.id !== targetTabId) return tab;

            if (replaceId) {
              const oldCol = tab.columns.find((c) => c.id === replaceId);
              if (oldCol) {
                // Remove old column cells
                for (const k of Object.keys(nextCells)) {
                  if (k.endsWith(`::${replaceId}`)) delete nextCells[k];
                }
                const targetFolderId =
                  options?.targetFolderId !== undefined ? options.targetFolderId : oldCol.folderId;
                const clonedCol = cloneSingleColumn(srcCol, oldCol.orderIndex, targetFolderId);
                createdColId = clonedCol.id;

                const currentOrder = getCanonicalItemOrder(tab);
                const nextOrder =
                  targetFolderId === null
                    ? currentOrder.map((id) => (id === replaceId ? clonedCol.id : id))
                    : currentOrder.filter((id) => id !== replaceId);
                if (targetFolderId === null && !nextOrder.includes(clonedCol.id)) {
                  nextOrder.push(clonedCol.id);
                }

                const nextCols = tab.columns.map((c) => (c.id === replaceId ? clonedCol : c));
                return syncTabOrderIndices({ ...tab, columns: nextCols }, nextOrder);
              }
            }

            const targetFolderId = options?.targetFolderId ?? null;
            const clonedCol = cloneSingleColumn(srcCol, tab.columns.length, targetFolderId);
            createdColId = clonedCol.id;
            const currentOrder = getCanonicalItemOrder(tab);
            const nextOrder =
              targetFolderId === null ? [...currentOrder, clonedCol.id] : currentOrder;
            return syncTabOrderIndices(
              { ...tab, columns: [...tab.columns, clonedCol] },
              nextOrder
            );
          });

          // If a column was replaced, seamlessly remap any AVERAGE formulas referencing the old column
          if (replaceId && createdColId) {
            const newId = createdColId;
            nextTabs = nextTabs.map((tab) => ({
              ...tab,
              columns: tab.columns.map((c) => {
                if (!c.averageConfig?.sourceColumnIds.includes(replaceId)) return c;
                const nextWeights = { ...c.averageConfig.weights };
                if (nextWeights[replaceId] !== undefined) {
                  nextWeights[newId] = nextWeights[replaceId];
                  delete nextWeights[replaceId];
                }
                return {
                  ...c,
                  averageConfig: {
                    ...c.averageConfig,
                    sourceColumnIds: c.averageConfig.sourceColumnIds.map((id) =>
                      id === replaceId ? newId : id
                    ),
                    weights: nextWeights,
                  },
                };
              }),
            }));
          }

          return recalculateBook({ ...book, tabs: nextTabs, cells: nextCells }, prev.rubrics);
        };

        return {
          ...prev,
          classes: prev.classes.map(mutateBook),
          templates: prev.templates.map(mutateBook),
        };
      });
    },
    [commit]
  );

  const copyColumnsToTarget = useCallback<GradebookContextValue['copyColumnsToTarget']>(
    (sourceBookId, items, targetClassId, targetTabId, options) => {
      if (items.length === 0) return;
      commit((prev) => {
        const srcBook =
          prev.classes.find((c) => c.id === sourceBookId) ??
          prev.templates.find((t) => t.id === sourceBookId);
        if (!srcBook) return prev;

        const srcColsMap = new Map(
          srcBook.tabs.flatMap((t) => t.columns).map((c) => [c.id, c] as const)
        );
        const resolvedItems = items
          .map((item) => {
            const srcCol = srcColsMap.get(item.columnId);
            return srcCol ? { ...item, srcCol } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (resolvedItems.length === 0) return prev;

        const mutateBook = (book: ClassBook): ClassBook => {
          if (book.id !== targetClassId) return book;

          let nextCells = { ...book.cells };
          const replacedIdMap = new Map<string, string>();
          const clonedBatch = cloneColumnBatch(
            resolvedItems.map((i) => i.srcCol),
            0,
            options?.targetFolderId ?? null
          );

          let nextTabs = book.tabs.map((tab) => {
            if (tab.id !== targetTabId) return tab;

            let nextCols = [...tab.columns];
            let nextOrder = getCanonicalItemOrder(tab);

            resolvedItems.forEach((item, idx) => {
              const clonedBase = clonedBatch[idx];
              const replaceId = item.mode === 'REPLACE' ? item.replaceColumnId : undefined;

              if (replaceId) {
                const oldCol = nextCols.find((c) => c.id === replaceId);
                if (oldCol) {
                  for (const k of Object.keys(nextCells)) {
                    if (k.endsWith(`::${replaceId}`)) delete nextCells[k];
                  }
                  const effectiveFolderId =
                    options?.targetFolderId !== undefined
                      ? options.targetFolderId
                      : oldCol.folderId;
                  const clonedCol: ColumnEntity = {
                    ...clonedBase,
                    folderId: effectiveFolderId,
                    orderIndex: oldCol.orderIndex,
                  };
                  replacedIdMap.set(replaceId, clonedCol.id);

                  nextOrder =
                    effectiveFolderId === null
                      ? nextOrder.map((id) => (id === replaceId ? clonedCol.id : id))
                      : nextOrder.filter((id) => id !== replaceId);
                  if (effectiveFolderId === null && !nextOrder.includes(clonedCol.id)) {
                    nextOrder.push(clonedCol.id);
                  }
                  nextCols = nextCols.map((c) => (c.id === replaceId ? clonedCol : c));
                  return;
                }
              }

              const effectiveFolderId = options?.targetFolderId ?? null;
              const clonedCol: ColumnEntity = {
                ...clonedBase,
                folderId: effectiveFolderId,
                orderIndex: nextCols.length,
              };
              nextCols.push(clonedCol);
              if (effectiveFolderId === null) {
                nextOrder = [...nextOrder, clonedCol.id];
              }
            });

            return syncTabOrderIndices({ ...tab, columns: nextCols }, nextOrder);
          });

          if (replacedIdMap.size > 0) {
            nextTabs = nextTabs.map((tab) => ({
              ...tab,
              columns: tab.columns.map((c) => {
                if (!c.averageConfig) return c;
                const needsRemap = c.averageConfig.sourceColumnIds.some((id) =>
                  replacedIdMap.has(id)
                );
                if (!needsRemap) return c;
                const nextWeights = { ...c.averageConfig.weights };
                for (const [oldId, newId] of replacedIdMap.entries()) {
                  if (nextWeights[oldId] !== undefined) {
                    nextWeights[newId] = nextWeights[oldId];
                    delete nextWeights[oldId];
                  }
                }
                return {
                  ...c,
                  averageConfig: {
                    ...c.averageConfig,
                    sourceColumnIds: c.averageConfig.sourceColumnIds.map(
                      (id) => replacedIdMap.get(id) ?? id
                    ),
                    weights: nextWeights,
                  },
                };
              }),
            }));
          }

          return recalculateBook({ ...book, tabs: nextTabs, cells: nextCells }, prev.rubrics);
        };

        return {
          ...prev,
          classes: prev.classes.map(mutateBook),
          templates: prev.templates.map(mutateBook),
        };
      });
    },
    [commit]
  );

  const copyFolderToTarget = useCallback<GradebookContextValue['copyFolderToTarget']>(
    (sourceBookId, sourceTabId, folderId, targetClassId, targetTabId, options) => {
      commit((prev) => {
        const srcBook =
          prev.classes.find((c) => c.id === sourceBookId) ??
          prev.templates.find((t) => t.id === sourceBookId);
        const srcTab = srcBook?.tabs.find((t) => t.id === sourceTabId);
        const srcFolder = srcTab?.folders.find((f) => f.id === folderId);
        if (!srcTab || !srcFolder) return prev;

        const srcChildren = srcTab.columns.filter((c) => c.folderId === srcFolder.id);
        const mode = options?.mode ?? 'ADD';
        const replaceId = mode === 'REPLACE' ? options?.replaceFolderId : undefined;

        const mutateBook = (book: ClassBook): ClassBook => {
          if (book.id !== targetClassId) return book;
          const nextCells = { ...book.cells };

          const nextTabs = book.tabs.map((tab) => {
            if (tab.id !== targetTabId) return tab;

            const currentOrder = getCanonicalItemOrder(tab);

            if (replaceId && tab.folders.some((f) => f.id === replaceId)) {
              const oldChildIds = new Set(
                tab.columns.filter((c) => c.folderId === replaceId).map((c) => c.id)
              );
              for (const k of Object.keys(nextCells)) {
                const colPart = k.split('::')[1];
                if (colPart && oldChildIds.has(colPart)) delete nextCells[k];
              }

              const { folder: clonedFld, columns: clonedCols } = cloneFolderWithColumns(
                srcFolder,
                srcChildren,
                tab.folders.length,
                tab.columns.length
              );

              const nextFolders = tab.folders.map((f) => (f.id === replaceId ? clonedFld : f));
              const remainingCols = tab.columns.filter((c) => c.folderId !== replaceId);
              const nextOrder = currentOrder.map((id) => (id === replaceId ? clonedFld.id : id));

              return syncTabOrderIndices(
                { ...tab, folders: nextFolders, columns: [...remainingCols, ...clonedCols] },
                nextOrder
              );
            }

            const { folder: clonedFld, columns: clonedCols } = cloneFolderWithColumns(
              srcFolder,
              srcChildren,
              tab.folders.length,
              tab.columns.length
            );
            const nextOrder = [...currentOrder, clonedFld.id];

            return syncTabOrderIndices(
              {
                ...tab,
                folders: [...tab.folders, clonedFld],
                columns: [...tab.columns, ...clonedCols],
              },
              nextOrder
            );
          });

          return recalculateBook({ ...book, tabs: nextTabs, cells: nextCells }, prev.rubrics);
        };

        return {
          ...prev,
          classes: prev.classes.map(mutateBook),
          templates: prev.templates.map(mutateBook),
        };
      });
    },
    [commit]
  );

  const copyTabToTarget = useCallback<GradebookContextValue['copyTabToTarget']>(
    (sourceBookId, sourceTabId, targetClassId, options) => {
      commit((prev) => {
        const srcBook =
          prev.classes.find((c) => c.id === sourceBookId) ??
          prev.templates.find((t) => t.id === sourceBookId);
        const srcTab = srcBook?.tabs.find((t) => t.id === sourceTabId);
        if (!srcTab) return prev;

        const mode = options?.mode ?? 'ADD';
        const replaceId = mode === 'REPLACE' ? options?.replaceTabId : undefined;
        let replacementNewTabId: string | null = null;

        const mutateBook = (book: ClassBook): ClassBook => {
          if (book.id !== targetClassId) return book;
          const nextCells = { ...book.cells };

          if (replaceId) {
            const oldTab = book.tabs.find((t) => t.id === replaceId);
            if (oldTab) {
              const oldColIds = new Set(oldTab.columns.map((c) => c.id));
              for (const k of Object.keys(nextCells)) {
                const colPart = k.split('::')[1];
                if (colPart && oldColIds.has(colPart)) delete nextCells[k];
              }
              const cloned = cloneTabEntity(srcTab, oldTab.orderIndex);
              replacementNewTabId = cloned.id;
              const nextTabs = book.tabs.map((t) => (t.id === replaceId ? cloned : t));
              return recalculateBook({ ...book, tabs: nextTabs, cells: nextCells }, prev.rubrics);
            }
          }

          const cloned = cloneTabEntity(srcTab, book.tabs.length);
          return recalculateBook(
            { ...book, tabs: [...book.tabs, cloned], cells: nextCells },
            prev.rubrics
          );
        };

        const nextClasses = prev.classes.map(mutateBook);
        const nextTemplates = prev.templates.map(mutateBook);
        const nextActiveTabByBook = { ...prev.activeTabByBook };
        if (replaceId && replacementNewTabId && nextActiveTabByBook[targetClassId] === replaceId) {
          nextActiveTabByBook[targetClassId] = replacementNewTabId;
        }

        return {
          ...prev,
          activeTabByBook: nextActiveTabByBook,
          classes: nextClasses,
          templates: nextTemplates,
        };
      });
    },
    [commit]
  );

  // =====================================================================
  // Tabs CRUD & Drag Reordering
  // =====================================================================
  const addTab = useCallback<GradebookContextValue['addTab']>(
    (title, color) => {
      if (!activeBook) return null;
      const newTab: TabEntity = {
        id: makeId('tab'),
        title: title.trim() || `Pestaña ${activeBook.tabs.length + 1}`,
        color: color || '#DBEAFE',
        orderIndex: activeBook.tabs.length,
        folders: [],
        columns: [
          {
            id: makeId('col'),
            folderId: null,
            title: 'Actividad 1',
            color: color || '#DBEAFE',
            width: 80,
            orderIndex: 0,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: activeBook.passThreshold,
            colorMode: 'CELL_BG',
          },
        ],
      };

      mutateActiveBook((book) => ({
        ...book,
        tabs: [...book.tabs, newTab],
      }));
      selectTab(newTab.id);
      return newTab;
    },
    [activeBook, mutateActiveBook, selectTab]
  );

  const updateTab = useCallback<GradebookContextValue['updateTab']>(
    (tabId, patch) => {
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
      }));
    },
    [mutateActiveBook]
  );

  const duplicateTab = useCallback<GradebookContextValue['duplicateTab']>(
    (tabId, includeGrades) => {
      if (!activeBook) return;
      const srcTab = activeBook.tabs.find((t) => t.id === tabId);
      if (!srcTab) return;
      const cloned = cloneTabEntity(srcTab, activeBook.tabs.length);
      cloned.title = `${srcTab.title} (Copia)`;

      mutateActiveBook((book, ws) => {
        const nextCells = { ...book.cells };
        if (includeGrades) {
          srcTab.columns.forEach((origCol, idx) => {
            const newCol = cloned.columns[idx];
            if (!newCol) return;
            for (const st of book.students) {
              const cell = book.cells[cellKey(st.id, origCol.id)];
              if (cell) {
                nextCells[cellKey(st.id, newCol.id)] = structuredClone(cell);
              }
            }
          });
        }
        return recalculateBook({ ...book, tabs: [...book.tabs, cloned], cells: nextCells }, ws.rubrics);
      });
      selectTab(cloned.id);
    },
    [activeBook, mutateActiveBook, selectTab]
  );

  const deleteTab = useCallback<GradebookContextValue['deleteTab']>(
    (tabId) => {
      mutateActiveBook((book) => {
        if (book.tabs.length <= 1) return book;
        const remaining = book.tabs
          .filter((t) => t.id !== tabId)
          .map((t, idx) => ({ ...t, orderIndex: idx }));
        return { ...book, tabs: remaining };
      });
    },
    [mutateActiveBook]
  );

  const reorderTabs = useCallback<GradebookContextValue['reorderTabs']>(
    (draggedTabId, targetTabId) => {
      if (draggedTabId === targetTabId) return;
      mutateActiveBook((book) => {
        const sorted = [...book.tabs].sort((a, b) => a.orderIndex - b.orderIndex);
        const from = sorted.findIndex((t) => t.id === draggedTabId);
        const to = sorted.findIndex((t) => t.id === targetTabId);
        if (from < 0 || to < 0) return book;
        const [moved] = sorted.splice(from, 1);
        sorted.splice(to, 0, moved);
        return {
          ...book,
          tabs: sorted.map((t, idx) => ({ ...t, orderIndex: idx })),
        };
      });
    },
    [mutateActiveBook]
  );

  // =====================================================================
  // Folders CRUD
  // =====================================================================
  const addFolder = useCallback<GradebookContextValue['addFolder']>(
    (title, color) => {
      if (!activeTab) return null;
      const fld: FolderEntity = {
        id: makeId('fld'),
        title: title.trim() || 'Nueva Carpeta',
        color: color || '#DCFCE7',
        width: 80,
        orderIndex: activeTab.folders.length,
        isCollapsed: false,
        summaryMode: 'ARITHMETIC_MEAN',
        ignoreEmpty: true,
        colorMode: 'CELL_BG',
      };
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) => {
          if (t.id !== activeTab.id) return t;
          const nextOrder = [...getCanonicalItemOrder(t), fld.id];
          return syncTabOrderIndices({ ...t, folders: [...t.folders, fld] }, nextOrder);
        }),
      }));
      return fld;
    },
    [activeTab, mutateActiveBook]
  );

  const updateFolder = useCallback<GradebookContextValue['updateFolder']>(
    (tabId, folderId, patch) => {
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                folders: t.folders.map((f) => (f.id === folderId ? { ...f, ...patch } : f)),
              }
            : t
        ),
      }));
    },
    [mutateActiveBook]
  );

  const toggleFolderCollapse = useCallback<GradebookContextValue['toggleFolderCollapse']>(
    (tabId, folderId) => {
      mutateActiveBook(
        (book) => ({
          ...book,
          tabs: book.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  folders: t.folders.map((f) =>
                    f.id === folderId ? { ...f, isCollapsed: !f.isCollapsed } : f
                  ),
                }
              : t
          ),
        }),
        false
      );
    },
    [mutateActiveBook]
  );

  const deleteFolder = useCallback<GradebookContextValue['deleteFolder']>(
    (tabId, folderId) => {
      mutateActiveBook((book, ws) => {
        const suffix = `::${folderId}`;
        const nextCells = { ...book.cells };
        for (const k of Object.keys(nextCells)) {
          if (k.endsWith(suffix)) {
            delete nextCells[k];
          }
        }
        return recalculateBook(
          {
            ...book,
            cells: nextCells,
            tabs: book.tabs.map((t) => {
              if (t.id !== tabId) return t;
              const childIds = t.columns
                .filter((c) => c.folderId === folderId)
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((c) => c.id);
              const currentOrder = getCanonicalItemOrder(t);
              const nextOrder = currentOrder.flatMap((id) => (id === folderId ? childIds : [id]));
              return syncTabOrderIndices(
                {
                  ...t,
                  folders: t.folders.filter((f) => f.id !== folderId),
                  columns: t.columns.map((c) =>
                    c.folderId === folderId ? { ...c, folderId: null } : c
                  ),
                },
                nextOrder
              );
            }),
          },
          ws.rubrics
        );
      });
    },
    [mutateActiveBook]
  );

  const stepFolder = useCallback<GradebookContextValue['stepFolder']>(
    (tabId, folderId, dir) => {
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) =>
          t.id === tabId ? stepFolderHorizontally(t, folderId, dir) : t
        ),
      }));
    },
    [mutateActiveBook]
  );

  // =====================================================================
  // Columns CRUD, Resize & Drag Reorder
  // =====================================================================
  const addColumn = useCallback<GradebookContextValue['addColumn']>(
    (colData) => {
      if (!activeTab) return null;
      const newCol: ColumnEntity = {
        ...colData,
        id: makeId('col'),
        orderIndex: activeTab.columns.length,
      };
      mutateActiveBook((book, ws) => {
        const nextBook: ClassBook = {
          ...book,
          tabs: book.tabs.map((t) => {
            if (t.id !== activeTab.id) return t;
            const currentOrder = getCanonicalItemOrder(t);
            const nextOrder =
              newCol.folderId === null ? [...currentOrder, newCol.id] : currentOrder;
            return syncTabOrderIndices({ ...t, columns: [...t.columns, newCol] }, nextOrder);
          }),
        };
        return recalculateBook(nextBook, ws.rubrics);
      });
      return newCol;
    },
    [activeTab, mutateActiveBook]
  );

  const updateColumn = useCallback<GradebookContextValue['updateColumn']>(
    (columnId, patch) => {
      mutateActiveBook((book, ws) => {
        const nextBook: ClassBook = {
          ...book,
          tabs: book.tabs.map((t) => {
            const existing = t.columns.find((c) => c.id === columnId);
            if (!existing) return t;
            const updatedCols = t.columns.map((c) =>
              c.id === columnId ? { ...c, ...patch } : c
            );
            if (patch.folderId === undefined || patch.folderId === existing.folderId) {
              return { ...t, columns: updatedCols };
            }
            const currentOrder = getCanonicalItemOrder(t);
            let nextOrder = currentOrder.filter((id) => id !== columnId);
            if (patch.folderId === null) {
              // Moving out of folder -> insert right after former folder so it stays nearby
              const prevFolderIdx = existing.folderId ? nextOrder.indexOf(existing.folderId) : -1;
              if (prevFolderIdx >= 0) {
                nextOrder.splice(prevFolderIdx + 1, 0, columnId);
              } else {
                nextOrder.push(columnId);
              }
            }
            return syncTabOrderIndices({ ...t, columns: updatedCols }, nextOrder);
          }),
        };
        return recalculateBook(nextBook, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  const deleteColumn = useCallback<GradebookContextValue['deleteColumn']>(
    (columnId) => {
      mutateActiveBook((book, ws) => {
        const nextCells = { ...book.cells };
        for (const k of Object.keys(nextCells)) {
          if (k.endsWith(`::${columnId}`)) delete nextCells[k];
        }
        const nextBook: ClassBook = {
          ...book,
          cells: nextCells,
          tabs: book.tabs.map((t) => {
            if (!t.columns.some((c) => c.id === columnId)) return t;
            const nextOrder = getCanonicalItemOrder(t).filter((id) => id !== columnId);
            return syncTabOrderIndices(
              { ...t, columns: t.columns.filter((c) => c.id !== columnId) },
              nextOrder
            );
          }),
        };
        return recalculateBook(nextBook, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  const duplicateColumn = useCallback<GradebookContextValue['duplicateColumn']>(
    (columnId, includeGrades) => {
      mutateActiveBook((book, ws) => {
        const tab = book.tabs.find((t) => t.columns.some((c) => c.id === columnId));
        const src = tab?.columns.find((c) => c.id === columnId);
        if (!tab || !src) return book;

        const copy = cloneSingleColumn(src, tab.columns.length, src.folderId);
        copy.title = `${src.title} (Copia)`;
        const nextCells = { ...book.cells };
        if (includeGrades) {
          for (const st of book.students) {
            const c = book.cells[cellKey(st.id, src.id)];
            if (c) nextCells[cellKey(st.id, copy.id)] = structuredClone(c);
          }
        }
        const nextBook: ClassBook = {
          ...book,
          cells: nextCells,
          tabs: book.tabs.map((t) => {
            if (t.id !== tab.id) return t;
            const currentOrder = getCanonicalItemOrder(t);
            const nextOrder = [...currentOrder];
            if (copy.folderId === null) {
              const srcIdx = nextOrder.indexOf(src.id);
              if (srcIdx >= 0) nextOrder.splice(srcIdx + 1, 0, copy.id);
              else nextOrder.push(copy.id);
            }
            return syncTabOrderIndices({ ...t, columns: [...t.columns, copy] }, nextOrder);
          }),
        };
        return recalculateBook(nextBook, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  const resizeColumn = useCallback<GradebookContextValue['resizeColumn']>(
    (columnId, width) => {
      const clamped = Math.max(36, Math.min(360, Math.round(width)));
      const before = !aspectTxBeforeRef.current ? captureAspectSnapshot(workspaceRef.current) : null;
      mutateActiveBook(
        (book) => ({
          ...book,
          tabs: book.tabs.map((t) => ({
            ...t,
            columns: t.columns.map((c) => (c.id === columnId ? { ...c, width: clamped } : c)),
          })),
        }),
        false
      );
      if (before) {
        const after = captureAspectSnapshot(workspaceRef.current);
        if (!aspectSnapshotsEqual(before, after)) pushAspectUndo(before);
      }
    },
    [mutateActiveBook, pushAspectUndo]
  );

  const resizeFolder = useCallback<GradebookContextValue['resizeFolder']>(
    (tabId, folderId, width) => {
      const clamped = Math.max(38, Math.min(280, Math.round(width)));
      const before = !aspectTxBeforeRef.current ? captureAspectSnapshot(workspaceRef.current) : null;
      mutateActiveBook(
        (book) => ({
          ...book,
          tabs: book.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  folders: t.folders.map((f) =>
                    f.id === folderId ? { ...f, width: clamped } : f
                  ),
                }
              : t
          ),
        }),
        false
      );
      if (before) {
        const after = captureAspectSnapshot(workspaceRef.current);
        if (!aspectSnapshotsEqual(before, after)) pushAspectUndo(before);
      }
    },
    [mutateActiveBook, pushAspectUndo]
  );

  // =====================================================================
  // Bottom Summary Rows (global across all classes, templates, and tabs)
  // =====================================================================
  const addSummaryRow = useCallback<GradebookContextValue['addSummaryRow']>(
    (metric) => {
      commit((prev) => {
        const current = resolveGlobalSummaryRows(prev);
        if (current.length >= 25) return prev;
        const nextRows = [...current, metric];
        return {
          ...prev,
          settings: { ...prev.settings, globalSummaryRows: nextRows },
          classes: prev.classes.map((b) => ({ ...b, summaryRows: nextRows })),
          templates: prev.templates.map((b) => ({ ...b, summaryRows: nextRows })),
        };
      });
    },
    [commit]
  );

  const updateGlobalSummaryRow = useCallback<GradebookContextValue['updateGlobalSummaryRow']>(
    (rowIndex, metric, clearColumnOverrides = false) => {
      commit((prev) => {
        const current = resolveGlobalSummaryRows(prev);
        if (rowIndex < 0 || rowIndex >= 25) return prev;
        while (current.length <= rowIndex) current.push('NONE');
        current[rowIndex] = metric;

        const applyBookSummaryUpdate = (book: ClassBook): ClassBook => {
          const nextTabs = clearColumnOverrides
            ? book.tabs.map((t) => ({
                ...t,
                columns: t.columns.map((c) => {
                  if (!c.summaryRowOverrides || !(rowIndex in c.summaryRowOverrides)) return c;
                  const copy = { ...c.summaryRowOverrides };
                  delete copy[rowIndex];
                  return { ...c, summaryRowOverrides: copy };
                }),
                folders: t.folders.map((f) => {
                  if (!f.summaryRowOverrides || !(rowIndex in f.summaryRowOverrides)) return f;
                  const copy = { ...f.summaryRowOverrides };
                  delete copy[rowIndex];
                  return { ...f, summaryRowOverrides: copy };
                }),
              }))
            : book.tabs;

          return {
            ...book,
            summaryRows: current,
            tabs: nextTabs,
          };
        };

        return {
          ...prev,
          settings: { ...prev.settings, globalSummaryRows: current },
          classes: prev.classes.map(applyBookSummaryUpdate),
          templates: prev.templates.map(applyBookSummaryUpdate),
        };
      });
    },
    [commit]
  );

  const removeSummaryRow = useCallback<GradebookContextValue['removeSummaryRow']>(
    (rowIndex) => {
      commit((prev) => {
        const current = resolveGlobalSummaryRows(prev);
        if (rowIndex < 0 || rowIndex >= current.length) return prev;
        current.splice(rowIndex, 1);

        const shiftOverrides = (
          overrides?: Record<number, ColumnSummaryMetric>
        ): Record<number, ColumnSummaryMetric> | undefined => {
          if (!overrides) return undefined;
          const next: Record<number, ColumnSummaryMetric> = {};
          for (const [kStr, val] of Object.entries(overrides)) {
            const k = Number(kStr);
            if (k < rowIndex) next[k] = val;
            else if (k > rowIndex) next[k - 1] = val;
          }
          return Object.keys(next).length > 0 ? next : undefined;
        };

        const applyBookSummaryRemoval = (book: ClassBook): ClassBook => ({
          ...book,
          summaryRows: current,
          tabs: book.tabs.map((t) => ({
            ...t,
            columns: t.columns.map((c) => ({
              ...c,
              summaryRowOverrides: shiftOverrides(c.summaryRowOverrides),
            })),
            folders: t.folders.map((f) => ({
              ...f,
              summaryRowOverrides: shiftOverrides(f.summaryRowOverrides),
            })),
          })),
        });

        return {
          ...prev,
          settings: { ...prev.settings, globalSummaryRows: current },
          classes: prev.classes.map(applyBookSummaryRemoval),
          templates: prev.templates.map(applyBookSummaryRemoval),
        };
      });
    },
    [commit]
  );

  const setColumnSummaryOverride = useCallback<GradebookContextValue['setColumnSummaryOverride']>(
    (target, rowIndex, metric) => {
      mutateActiveBook((book) => {
        const applyOverride = (
          prev?: Record<number, ColumnSummaryMetric>
        ): Record<number, ColumnSummaryMetric> | undefined => {
          const next = { ...(prev ?? {}) };
          if (metric === null) {
            delete next[rowIndex];
          } else {
            next[rowIndex] = metric;
          }
          return Object.keys(next).length > 0 ? next : undefined;
        };

        return {
          ...book,
          tabs: book.tabs.map((t) => {
            if (target.kind === 'COL') {
              return {
                ...t,
                columns: t.columns.map((c) =>
                  c.id === target.id
                    ? { ...c, summaryRowOverrides: applyOverride(c.summaryRowOverrides) }
                    : c
                ),
              };
            }
            if (t.id !== target.tabId) return t;
            return {
              ...t,
              folders: t.folders.map((f) =>
                f.id === target.id
                  ? { ...f, summaryRowOverrides: applyOverride(f.summaryRowOverrides) }
                  : f
              ),
            };
          }),
        };
      });
    },
    [mutateActiveBook]
  );

  const applyUniformColumnWidth = useCallback<GradebookContextValue['applyUniformColumnWidth']>(
    (width, scope = 'TAB') => {
      const clamped = Math.max(36, Math.min(360, Math.round(width)));
      const tabId = activeTab?.id;
      const before = !aspectTxBeforeRef.current ? captureAspectSnapshot(workspaceRef.current) : null;
      commit((prev) => {
        const targetBookId =
          prev.activeMode === 'TEMPLATE'
            ? (prev.activeTemplateId ?? prev.templates[0]?.id)
            : (prev.activeClassId ?? prev.classes[0]?.id);
        const updateBookCols = (book: ClassBook): ClassBook => {
          if (scope !== 'ALL' && book.id !== targetBookId) return book;
          return {
            ...book,
            tabs: book.tabs.map((t) =>
              scope === 'ALL' || scope === 'BOOK' || t.id === tabId
                ? { ...t, columns: t.columns.map((c) => ({ ...c, width: clamped })) }
                : t
            ),
          };
        };
        return {
          ...prev,
          settings: { ...prev.settings, defaultColumnWidth: clamped },
          classes: prev.classes.map(updateBookCols),
          templates: prev.templates.map(updateBookCols),
        };
      }, false);
      if (before) {
        const after = captureAspectSnapshot(workspaceRef.current);
        if (!aspectSnapshotsEqual(before, after)) pushAspectUndo(before);
      }
    },
    [activeTab?.id, commit, pushAspectUndo]
  );

  const applyUniformFolderWidth = useCallback<GradebookContextValue['applyUniformFolderWidth']>(
    (width, scope = 'TAB') => {
      const clamped = Math.max(38, Math.min(280, Math.round(width)));
      const tabId = activeTab?.id;
      const before = !aspectTxBeforeRef.current ? captureAspectSnapshot(workspaceRef.current) : null;
      commit((prev) => {
        const targetBookId =
          prev.activeMode === 'TEMPLATE'
            ? (prev.activeTemplateId ?? prev.templates[0]?.id)
            : (prev.activeClassId ?? prev.classes[0]?.id);
        const updateBookFolders = (book: ClassBook): ClassBook =>
          book.id !== targetBookId
            ? book
            : {
                ...book,
                tabs: book.tabs.map((t) =>
                  scope === 'BOOK' || t.id === tabId
                    ? { ...t, folders: t.folders.map((f) => ({ ...f, width: clamped })) }
                    : t
                ),
              };
        return {
          ...prev,
          settings: { ...prev.settings, defaultFolderWidth: clamped },
          classes: prev.classes.map(updateBookFolders),
          templates: prev.templates.map(updateBookFolders),
        };
      }, false);
      if (before) {
        const after = captureAspectSnapshot(workspaceRef.current);
        if (!aspectSnapshotsEqual(before, after)) pushAspectUndo(before);
      }
    },
    [activeTab?.id, commit, pushAspectUndo]
  );

  // =====================================================================
  // Per-Group Bottom Summary Rows (configuring one configures ALL groups)
  // =====================================================================
  const addGroupSummaryRow = useCallback<GradebookContextValue['addGroupSummaryRow']>(
    (metric) => {
      mutateActiveBook((book) => {
        const current = book.groupSummaryRows ?? (['MEAN'] as ColumnSummaryMetric[]);
        if (current.length >= 25) return book;
        return {
          ...book,
          groupSummaryRows: [...current, metric],
        };
      });
    },
    [mutateActiveBook]
  );

  const updateGlobalGroupSummaryRow = useCallback<
    GradebookContextValue['updateGlobalGroupSummaryRow']
  >(
    (rowIndex, metric, clearColumnOverrides = false) => {
      mutateActiveBook((book) => {
        const current = [...(book.groupSummaryRows ?? (['MEAN'] as ColumnSummaryMetric[]))];
        if (rowIndex < 0 || rowIndex >= 25) return book;
        while (current.length <= rowIndex) current.push('NONE');
        current[rowIndex] = metric;

        const nextTabs = clearColumnOverrides
          ? book.tabs.map((t) => ({
              ...t,
              columns: t.columns.map((c) => {
                if (!c.groupSummaryRowOverrides || !(rowIndex in c.groupSummaryRowOverrides))
                  return c;
                const copy = { ...c.groupSummaryRowOverrides };
                delete copy[rowIndex];
                return { ...c, groupSummaryRowOverrides: copy };
              }),
              folders: t.folders.map((f) => {
                if (!f.groupSummaryRowOverrides || !(rowIndex in f.groupSummaryRowOverrides))
                  return f;
                const copy = { ...f.groupSummaryRowOverrides };
                delete copy[rowIndex];
                return { ...f, groupSummaryRowOverrides: copy };
              }),
            }))
          : book.tabs;

        return {
          ...book,
          groupSummaryRows: current,
          tabs: nextTabs,
        };
      });
    },
    [mutateActiveBook]
  );

  const removeGroupSummaryRow = useCallback<GradebookContextValue['removeGroupSummaryRow']>(
    (rowIndex) => {
      mutateActiveBook((book) => {
        const current = [...(book.groupSummaryRows ?? (['MEAN'] as ColumnSummaryMetric[]))];
        if (rowIndex < 0 || rowIndex >= current.length) return book;
        current.splice(rowIndex, 1);

        const shiftOverrides = (
          overrides?: Record<number, ColumnSummaryMetric>
        ): Record<number, ColumnSummaryMetric> | undefined => {
          if (!overrides) return undefined;
          const next: Record<number, ColumnSummaryMetric> = {};
          for (const [kStr, val] of Object.entries(overrides)) {
            const k = Number(kStr);
            if (k < rowIndex) next[k] = val;
            else if (k > rowIndex) next[k - 1] = val;
          }
          return Object.keys(next).length > 0 ? next : undefined;
        };

        return {
          ...book,
          groupSummaryRows: current,
          tabs: book.tabs.map((t) => ({
            ...t,
            columns: t.columns.map((c) => ({
              ...c,
              groupSummaryRowOverrides: shiftOverrides(c.groupSummaryRowOverrides),
            })),
            folders: t.folders.map((f) => ({
              ...f,
              groupSummaryRowOverrides: shiftOverrides(f.groupSummaryRowOverrides),
            })),
          })),
        };
      });
    },
    [mutateActiveBook]
  );

  const setColumnGroupSummaryOverride = useCallback<
    GradebookContextValue['setColumnGroupSummaryOverride']
  >(
    (target, rowIndex, metric) => {
      mutateActiveBook((book) => {
        const applyOverride = (
          prev?: Record<number, ColumnSummaryMetric>
        ): Record<number, ColumnSummaryMetric> | undefined => {
          const next = { ...(prev ?? {}) };
          if (metric === null) {
            delete next[rowIndex];
          } else {
            next[rowIndex] = metric;
          }
          return Object.keys(next).length > 0 ? next : undefined;
        };

        return {
          ...book,
          tabs: book.tabs.map((t) => {
            if (target.kind === 'COL') {
              return {
                ...t,
                columns: t.columns.map((c) =>
                  c.id === target.id
                    ? { ...c, groupSummaryRowOverrides: applyOverride(c.groupSummaryRowOverrides) }
                    : c
                ),
              };
            }
            if (t.id !== target.tabId) return t;
            return {
              ...t,
              folders: t.folders.map((f) =>
                f.id === target.id
                  ? { ...f, groupSummaryRowOverrides: applyOverride(f.groupSummaryRowOverrides) }
                  : f
              ),
            };
          }),
        };
      });
    },
    [mutateActiveBook]
  );

  const moveItemInActiveTab = useCallback<GradebookContextValue['moveItemInActiveTab']>(
    (drag, target) => {
      if (!activeTab) return;
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) => (t.id === activeTab.id ? moveItemInTab(t, drag, target) : t)),
      }));
    },
    [activeTab, mutateActiveBook]
  );

  const stepColumn = useCallback<GradebookContextValue['stepColumn']>(
    (columnId, dir) => {
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) =>
          t.columns.some((c) => c.id === columnId) ? stepColumnHorizontally(t, columnId, dir) : t
        ),
      }));
    },
    [mutateActiveBook]
  );

  const reorderColumn = useCallback<GradebookContextValue['reorderColumn']>(
    (draggedColId, targetColId, targetFolderId) => {
      if (draggedColId === targetColId) return;
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) => {
          if (!t.columns.some((c) => c.id === draggedColId)) return t;
          if (targetFolderId !== undefined && targetFolderId !== null) {
            return moveItemInTab(
              t,
              { kind: 'COL', id: draggedColId },
              { kind: 'COL', id: targetColId }
            );
          }
          return moveItemInTab(
            t,
            { kind: 'COL', id: draggedColId },
            { kind: 'COL', id: targetColId }
          );
        }),
      }));
    },
    [mutateActiveBook]
  );

  const moveColumnToFolder = useCallback<GradebookContextValue['moveColumnToFolder']>(
    (columnId, folderId) => {
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) => {
          const existing = t.columns.find((c) => c.id === columnId);
          if (!existing) return t;
          if (folderId === null) {
            const currentOrder = getCanonicalItemOrder(t).filter((id) => id !== columnId);
            const prevIdx = existing.folderId ? currentOrder.indexOf(existing.folderId) : -1;
            if (prevIdx >= 0) currentOrder.splice(prevIdx + 1, 0, columnId);
            else currentOrder.push(columnId);
            return syncTabOrderIndices(
              {
                ...t,
                columns: t.columns.map((c) => (c.id === columnId ? { ...c, folderId: null } : c)),
              },
              currentOrder
            );
          }
          return moveItemInTab(
            t,
            { kind: 'COL', id: columnId },
            { kind: 'FOLDER', id: folderId, position: 'INSIDE' }
          );
        }),
      }));
    },
    [mutateActiveBook]
  );

  const moveColumnToTab = useCallback<GradebookContextValue['moveColumnToTab']>(
    (columnId, targetTabId) => {
      mutateActiveBook((book, ws) => {
        const srcTab = book.tabs.find((t) => t.columns.some((c) => c.id === columnId));
        const col = srcTab?.columns.find((c) => c.id === columnId);
        if (!srcTab || !col || srcTab.id === targetTabId) return book;

        const nextTabs = book.tabs.map((t) => {
          if (t.id === srcTab.id) {
            const nextOrder = getCanonicalItemOrder(t).filter((id) => id !== columnId);
            return syncTabOrderIndices(
              { ...t, columns: t.columns.filter((c) => c.id !== columnId) },
              nextOrder
            );
          }
          if (t.id === targetTabId) {
            const nextOrder = [...getCanonicalItemOrder(t), col.id];
            return syncTabOrderIndices(
              {
                ...t,
                columns: [...t.columns, { ...col, folderId: null, orderIndex: t.columns.length }],
              },
              nextOrder
            );
          }
          return t;
        });

        return recalculateBook({ ...book, tabs: nextTabs }, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  // =====================================================================
  // Students CRUD & Reorder
  // =====================================================================
  const addStudent = useCallback<GradebookContextValue['addStudent']>(
    (data) => {
      if (!activeBook) return null;
      const st: StudentEntity = {
        ...data,
        id: makeId('st'),
        orderIndex: activeBook.students.length,
      };
      mutateActiveBook((book, ws) => {
        let nextBook: ClassBook = { ...book, students: [...book.students, st] };
        const cleanGroup = st.group?.trim();
        if (cleanGroup && book.groupCategories && book.groupCategories.length > 0) {
          const { categories } = ensureGroupCategories(book);
          const defaultCat = categories[0];
          const hasGroup = defaultCat.groups.some(
            (g) => g.name.trim().toLowerCase() === cleanGroup.toLowerCase()
          );
          const nextCatGroups = hasGroup
            ? defaultCat.groups
            : [
                ...defaultCat.groups,
                {
                  id: makeId('grp'),
                  name: cleanGroup,
                  color: getGroupDefaultColor(cleanGroup),
                  orderIndex: defaultCat.groups.length,
                },
              ];
          const updatedCat: GroupCategoryDef = {
            ...defaultCat,
            groups: nextCatGroups,
            assignments: { ...defaultCat.assignments, [st.id]: cleanGroup },
          };
          nextBook = {
            ...nextBook,
            groups: nextCatGroups,
            groupCategories: [updatedCat, ...categories.slice(1)],
          };
        }
        return recalculateBook(nextBook, ws.rubrics);
      });
      return st;
    },
    [activeBook, mutateActiveBook]
  );

  const bulkImportStudents = useCallback<GradebookContextValue['bulkImportStudents']>(
    (incoming, mode) => {
      if (!activeBook || incoming.length === 0) return;
      mutateActiveBook((book, ws) => {
        let nextStudents: StudentEntity[];
        let addedStudents: StudentEntity[];
        if (mode === 'REPLACE') {
          addedStudents = incoming.map((s, idx) => ({
            id: makeId('st'),
            firstName: s.firstName,
            lastName: s.lastName,
            group: s.group,
            tags: [],
            orderIndex: idx,
          }));
          nextStudents = addedStudents;
        } else {
          const startIndex = book.students.length;
          addedStudents = incoming.map((s, idx) => ({
            id: makeId('st'),
            firstName: s.firstName,
            lastName: s.lastName,
            group: s.group,
            tags: [],
            orderIndex: startIndex + idx,
          }));
          nextStudents = [...book.students, ...addedStudents];
        }

        let nextBook: ClassBook = { ...book, students: nextStudents };
        if (book.groupCategories && book.groupCategories.length > 0) {
          const { categories } = ensureGroupCategories(book);
          const validIds = new Set(nextStudents.map((s) => s.id));
          const updatedCategories = categories.map((cat, idx) => {
            const cleanedAssignments: Record<string, string> = {};
            for (const [sid, grp] of Object.entries(cat.assignments)) {
              if (validIds.has(sid)) cleanedAssignments[sid] = grp;
            }
            if (idx !== 0) {
              return { ...cat, assignments: cleanedAssignments };
            }
            const nextGroups = [...cat.groups];
            for (const st of addedStudents) {
              const cleanGroup = st.group?.trim();
              if (!cleanGroup) continue;
              cleanedAssignments[st.id] = cleanGroup;
              if (
                !nextGroups.some((g) => g.name.trim().toLowerCase() === cleanGroup.toLowerCase())
              ) {
                nextGroups.push({
                  id: makeId('grp'),
                  name: cleanGroup,
                  color: getGroupDefaultColor(cleanGroup),
                  orderIndex: nextGroups.length,
                });
              }
            }
            return { ...cat, groups: nextGroups, assignments: cleanedAssignments };
          });
          nextBook = {
            ...nextBook,
            groups: updatedCategories[0]?.groups,
            groupCategories: updatedCategories,
          };
        }
        return recalculateBook(nextBook, ws.rubrics);
      });
    },
    [activeBook, mutateActiveBook]
  );

  const updateStudent = useCallback<GradebookContextValue['updateStudent']>(
    (studentId, patch) => {
      mutateActiveBook((book) => {
        const nextStudents = book.students.map((s) =>
          s.id === studentId ? { ...s, ...patch } : s
        );
        if ('group' in patch && book.groupCategories && book.groupCategories.length > 0) {
          const { categories, activeCategory } = ensureGroupCategories(book);
          const nextAssignments = { ...activeCategory.assignments };
          const cleanGrp = patch.group?.trim();
          if (cleanGrp) nextAssignments[studentId] = cleanGrp;
          else delete nextAssignments[studentId];
          return {
            ...book,
            students: nextStudents,
            groupCategories: categories.map((c) =>
              c.id === activeCategory.id ? { ...c, assignments: nextAssignments } : c
            ),
          };
        }
        return {
          ...book,
          students: nextStudents,
        };
      });
    },
    [mutateActiveBook]
  );

  const deleteStudent = useCallback<GradebookContextValue['deleteStudent']>(
    (studentId) => {
      mutateActiveBook((book, ws) => {
        const nextCells = { ...book.cells };
        for (const k of Object.keys(nextCells)) {
          if (k.startsWith(`${studentId}::`)) delete nextCells[k];
        }
        const nextCategories = book.groupCategories?.map((cat) => {
          const nextAssignments = { ...cat.assignments };
          delete nextAssignments[studentId];
          return { ...cat, assignments: nextAssignments };
        });
        return recalculateBook(
          {
            ...book,
            students: book.students.filter((s) => s.id !== studentId),
            ...(nextCategories ? { groupCategories: nextCategories } : {}),
            cells: nextCells,
          },
          ws.rubrics
        );
      });
    },
    [mutateActiveBook]
  );

  const reorderStudents = useCallback<GradebookContextValue['reorderStudents']>(
    (orderedIds, groupReassignment) => {
      const rank = new Map(orderedIds.map((id, idx) => [id, idx]));
      mutateActiveBook((book) => {
        const nextStudents = book.students.map((s) => {
          const nextOrder = rank.get(s.id) ?? s.orderIndex;
          if (groupReassignment && groupReassignment.studentId === s.id) {
            return {
              ...s,
              orderIndex: nextOrder,
              group: groupReassignment.group || undefined,
            };
          }
          return { ...s, orderIndex: nextOrder };
        });

        if (groupReassignment && book.groupCategories && book.groupCategories.length > 0) {
          const { categories, activeCategory } = ensureGroupCategories(book);
          const nextAssignments = { ...activeCategory.assignments };
          if (groupReassignment.group?.trim()) {
            nextAssignments[groupReassignment.studentId] = groupReassignment.group.trim();
          } else {
            delete nextAssignments[groupReassignment.studentId];
          }
          return {
            ...book,
            sortMode: 'MANUAL',
            students: nextStudents,
            groupCategories: categories.map((c) =>
              c.id === activeCategory.id ? { ...c, assignments: nextAssignments } : c
            ),
          };
        }

        return {
          ...book,
          sortMode: 'MANUAL',
          students: nextStudents,
        };
      });
    },
    [mutateActiveBook]
  );

  // =====================================================================
  // Student Groups & Multiple Group Categories CRUD
  // =====================================================================
  const createGroupCategory = useCallback<GradebookContextValue['createGroupCategory']>(
    (name) => {
      const clean = name.trim();
      if (!clean || !activeBook) return null;
      const newCat: GroupCategoryDef = {
        id: makeId('gcat'),
        name: clean,
        groups: [],
        assignments: {},
      };
      mutateActiveBook((book) => {
        const { categories } = ensureGroupCategories(book);
        return {
          ...book,
          groupCategories: [...categories, newCat],
          activeGroupCategoryId: newCat.id,
          collapsedGroups: [],
        };
      });
      return newCat;
    },
    [activeBook, mutateActiveBook]
  );

  const renameGroupCategory = useCallback<GradebookContextValue['renameGroupCategory']>(
    (categoryId, name) => {
      const clean = name.trim();
      if (!clean) return;
      mutateActiveBook((book) => {
        const { categories, activeCategory } = ensureGroupCategories(book);
        return {
          ...book,
          groupCategories: categories.map((c) =>
            c.id === categoryId ? { ...c, name: clean } : c
          ),
          activeGroupCategoryId: book.activeGroupCategoryId ?? activeCategory.id,
        };
      });
    },
    [mutateActiveBook]
  );

  const deleteGroupCategory = useCallback<GradebookContextValue['deleteGroupCategory']>(
    (categoryId) => {
      mutateActiveBook((book) => {
        const { categories, activeCategory } = ensureGroupCategories(book);
        if (categories.length <= 1) return book;
        const remaining = categories.filter((c) => c.id !== categoryId);
        const nextActive =
          activeCategory.id === categoryId ? remaining[0] : activeCategory;
        return {
          ...book,
          groupCategories: remaining,
          activeGroupCategoryId: nextActive.id,
          collapsedGroups: [],
        };
      });
    },
    [mutateActiveBook]
  );

  const selectGroupCategory = useCallback<GradebookContextValue['selectGroupCategory']>(
    (categoryId) => {
      mutateActiveBook((book) => {
        const { categories } = ensureGroupCategories(book);
        const target = categories.find((c) => c.id === categoryId);
        if (!target) return book;
        return {
          ...book,
          groupCategories: categories,
          activeGroupCategoryId: target.id,
          collapsedGroups: [],
        };
      });
    },
    [mutateActiveBook]
  );

  const upsertStudentGroup = useCallback<GradebookContextValue['upsertStudentGroup']>(
    (name, color, previousName) => {
      const cleanName = name.trim();
      if (!cleanName) return;

      mutateActiveBook((book) => {
        const { categories, activeCategory } = ensureGroupCategories(book);
        const current = getEffectiveBookGroups(book);
        const prevLow = previousName?.trim().toLowerCase();
        const targetLow = cleanName.toLowerCase();

        let nextGroups: StudentGroupDef[];
        if (prevLow && current.some((g) => g.name.trim().toLowerCase() === prevLow)) {
          nextGroups = current.map((g) =>
            g.name.trim().toLowerCase() === prevLow
              ? { ...g, name: cleanName, color: color || g.color }
              : g
          );
        } else if (current.some((g) => g.name.trim().toLowerCase() === targetLow)) {
          nextGroups = current.map((g) =>
            g.name.trim().toLowerCase() === targetLow
              ? { ...g, name: cleanName, color: color || g.color }
              : g
          );
        } else {
          nextGroups = [
            ...current,
            {
              id: makeId('grp'),
              name: cleanName,
              color: color || getGroupDefaultColor(cleanName),
              orderIndex: current.length,
            },
          ];
        }

        const deduped: StudentGroupDef[] = [];
        const seen = new Set<string>();
        for (const g of nextGroups) {
          const low = g.name.trim().toLowerCase();
          if (seen.has(low)) continue;
          seen.add(low);
          deduped.push({ ...g, orderIndex: deduped.length });
        }

        const nextAssignments = { ...activeCategory.assignments };
        if (prevLow) {
          for (const [sid, gVal] of Object.entries(nextAssignments)) {
            if (gVal.trim().toLowerCase() === prevLow) {
              nextAssignments[sid] = cleanName;
            }
          }
        }

        const nextCategories = categories.map((c) =>
          c.id === activeCategory.id
            ? { ...c, groups: deduped, assignments: nextAssignments }
            : c
        );

        const isDefaultCat = activeCategory.id === categories[0]?.id;
        const nextStudents = isDefaultCat
          ? book.students.map((s) => ({
              ...s,
              group: nextAssignments[s.id] || undefined,
            }))
          : book.students;

        const nextCollapsed =
          prevLow && book.collapsedGroups
            ? book.collapsedGroups.map((k) =>
                k.trim().toLowerCase() === prevLow ? cleanName : k
              )
            : book.collapsedGroups;

        return {
          ...book,
          groups: isDefaultCat ? deduped : book.groups,
          groupCategories: nextCategories,
          activeGroupCategoryId: activeCategory.id,
          students: nextStudents,
          collapsedGroups: nextCollapsed,
        };
      });
    },
    [mutateActiveBook]
  );

  const deleteStudentGroup = useCallback<GradebookContextValue['deleteStudentGroup']>(
    (groupName) => {
      const targetLow = groupName.trim().toLowerCase();
      if (!targetLow) return;
      mutateActiveBook((book) => {
        const { categories, activeCategory } = ensureGroupCategories(book);
        const current = getEffectiveBookGroups(book);
        const nextGroups = current
          .filter((g) => g.name.trim().toLowerCase() !== targetLow)
          .map((g, idx) => ({ ...g, orderIndex: idx }));

        const nextAssignments: Record<string, string> = {};
        for (const [sid, gVal] of Object.entries(activeCategory.assignments)) {
          if (gVal.trim().toLowerCase() !== targetLow) {
            nextAssignments[sid] = gVal;
          }
        }

        const nextCategories = categories.map((c) =>
          c.id === activeCategory.id
            ? { ...c, groups: nextGroups, assignments: nextAssignments }
            : c
        );

        const isDefaultCat = activeCategory.id === categories[0]?.id;
        const nextStudents = isDefaultCat
          ? book.students.map((s) => ({
              ...s,
              group: nextAssignments[s.id] || undefined,
            }))
          : book.students;

        const nextCollapsed = book.collapsedGroups?.filter(
          (k) => k.trim().toLowerCase() !== targetLow
        );
        return {
          ...book,
          groups: isDefaultCat ? nextGroups : book.groups,
          groupCategories: nextCategories,
          activeGroupCategoryId: activeCategory.id,
          students: nextStudents,
          collapsedGroups: nextCollapsed,
        };
      });
    },
    [mutateActiveBook]
  );

  const reorderStudentGroups = useCallback<GradebookContextValue['reorderStudentGroups']>(
    (orderedNames) => {
      const rank = new Map(orderedNames.map((n, i) => [n.trim().toLowerCase(), i]));
      mutateActiveBook((book) => {
        const { categories, activeCategory } = ensureGroupCategories(book);
        const current = getEffectiveBookGroups(book);
        const nextGroups = [...current]
          .sort((a, b) => {
            const ra = rank.get(a.name.trim().toLowerCase()) ?? a.orderIndex + 1000;
            const rb = rank.get(b.name.trim().toLowerCase()) ?? b.orderIndex + 1000;
            return ra - rb;
          })
          .map((g, idx) => ({ ...g, orderIndex: idx }));
        const nextCategories = categories.map((c) =>
          c.id === activeCategory.id ? { ...c, groups: nextGroups } : c
        );
        const isDefaultCat = activeCategory.id === categories[0]?.id;
        return {
          ...book,
          groups: isDefaultCat ? nextGroups : book.groups,
          groupCategories: nextCategories,
          activeGroupCategoryId: activeCategory.id,
        };
      });
    },
    [mutateActiveBook]
  );

  const assignStudentsToGroup = useCallback<GradebookContextValue['assignStudentsToGroup']>(
    (studentIds, groupName) => {
      if (studentIds.length === 0) return;
      const cleanName = groupName?.trim() || undefined;

      mutateActiveBook((book) => {
        const { categories, activeCategory } = ensureGroupCategories(book);
        const current = getEffectiveBookGroups(book);
        let nextGroups = current;
        if (
          cleanName &&
          !current.some((g) => g.name.trim().toLowerCase() === cleanName.toLowerCase())
        ) {
          nextGroups = [
            ...current,
            {
              id: makeId('grp'),
              name: cleanName,
              color: getGroupDefaultColor(cleanName),
              orderIndex: current.length,
            },
          ];
        }

        const nextAssignments = { ...activeCategory.assignments };
        for (const sid of studentIds) {
          if (cleanName) nextAssignments[sid] = cleanName;
          else delete nextAssignments[sid];
        }

        const nextCategories = categories.map((c) =>
          c.id === activeCategory.id
            ? { ...c, groups: nextGroups, assignments: nextAssignments }
            : c
        );

        const isDefaultCat = activeCategory.id === categories[0]?.id;
        const nextStudents = isDefaultCat
          ? book.students.map((s) => ({
              ...s,
              group: nextAssignments[s.id] || undefined,
            }))
          : book.students;

        return {
          ...book,
          groups: isDefaultCat ? nextGroups : book.groups,
          groupCategories: nextCategories,
          activeGroupCategoryId: activeCategory.id,
          students: nextStudents,
        };
      });
    },
    [mutateActiveBook]
  );

  const toggleGroupCollapsed = useCallback<GradebookContextValue['toggleGroupCollapsed']>(
    (groupKey) => {
      mutateActiveBook((book) => {
        const prev = book.collapsedGroups ?? [];
        const exists = prev.includes(groupKey);
        const next = exists ? prev.filter((k) => k !== groupKey) : [...prev, groupKey];
        return {
          ...book,
          collapsedGroups: next,
        };
      }, false);
    },
    [mutateActiveBook]
  );

  // =====================================================================
  // Cells CRUD
  // =====================================================================
  const normalizeCellTargetId = (rawId: string): string =>
    rawId.startsWith('fld-sum-') ? rawId.slice(8) : rawId;

  const applySingleCellInput = (
    bookSnapshot: ClassBook,
    nextCells: Record<string, ClassBook['cells'][string]>,
    colMap: Map<string, ColumnEntity>,
    folderMap: Map<string, { folder: FolderEntity; childCols: ColumnEntity[]; tabLocked: boolean }>,
    studentId: string,
    rawTargetId: string,
    grade: number | null,
    comment: string,
    options?: {
      preserveExistingGrade?: boolean;
      preserveExistingComment?: boolean;
      clearPendingAdjustment?: boolean;
      hasExplicitPendingAdjustment?: boolean;
      pendingAdjustment?: number;
      appliedAdjustment?: number;
      preAdjustmentGrade?: number;
      keepRubricAuto?: boolean;
    }
  ) => {
    const targetId = normalizeCellTargetId(rawTargetId);
    const k = cellKey(studentId, targetId);
    const prev = nextCells[k];

    let cleanComment = comment.trim();
    if (options?.preserveExistingComment && prev?.comment) {
      cleanComment = prev.comment;
    }

    let targetGrade = grade;
    if (options?.preserveExistingGrade && prev?.grade !== null && prev?.grade !== undefined) {
      targetGrade = prev.grade;
    }

    const col = colMap.get(targetId);
    if (col) {
      if (col.isLocked || col.type === 'AVERAGE') return;

      const prevPending =
        !options?.clearPendingAdjustment &&
        typeof prev?.pendingAdjustment === 'number' &&
        Number.isFinite(prev.pendingAdjustment) &&
        prev.pendingAdjustment !== 0
          ? prev.pendingAdjustment
          : undefined;

      const resolvePendingOutput = (enteringNumericGrade: boolean): number | undefined => {
        if (options?.hasExplicitPendingAdjustment) {
          return options.pendingAdjustment && options.pendingAdjustment !== 0
            ? options.pendingAdjustment
            : undefined;
        }
        if (options?.clearPendingAdjustment) return undefined;
        return enteringNumericGrade ? undefined : prevPending;
      };

      if (col.type === 'RUBRIC') {
        if (options?.hasExplicitPendingAdjustment && options?.keepRubricAuto && prev?.rubricEval) {
          const nextPending = resolvePendingOutput(false);
          nextCells[k] = {
            grade: targetGrade,
            comment: cleanComment,
            rubricEval: prev.rubricEval,
            manualOverride: undefined,
            pendingAdjustment: nextPending,
          };
        } else if (options?.hasExplicitPendingAdjustment && targetGrade === null) {
          const nextPending = resolvePendingOutput(false);
          if (!prev?.rubricEval && !cleanComment && !nextPending) {
            delete nextCells[k];
          } else {
            nextCells[k] = {
              grade: null,
              comment: cleanComment,
              rubricEval: prev?.rubricEval,
              manualOverride: prev?.manualOverride,
              pendingAdjustment: nextPending,
            };
          }
        } else if (options?.preserveExistingGrade || (targetGrade === null && (cleanComment || prevPending))) {
          const nextPending = resolvePendingOutput(false);
          if (prev?.grade === null && !prev?.rubricEval && !cleanComment && !nextPending) {
            delete nextCells[k];
          } else {
            nextCells[k] = {
              grade: prev?.grade ?? null,
              comment: cleanComment,
              rubricEval: prev?.rubricEval,
              manualOverride: prev?.manualOverride,
              pendingAdjustment: nextPending,
              appliedAdjustment: prev?.appliedAdjustment,
              preAdjustmentGrade: prev?.preAdjustmentGrade,
            };
          }
        } else if (targetGrade !== null) {
          const clampedBase = clampGradeForColumn(targetGrade, col);
          const adjustedTarget =
            !options?.hasExplicitPendingAdjustment && prevPending
              ? applyCounterDelta(targetGrade, prevPending, col)
              : targetGrade;
          const finalGrade = clampGradeForColumn(adjustedTarget, col);
          const nextApplied = options?.hasExplicitPendingAdjustment
            ? options.appliedAdjustment
            : prevPending;
          const nextPre = options?.hasExplicitPendingAdjustment
            ? options.preAdjustmentGrade
            : prevPending && clampedBase !== null
              ? clampedBase
              : undefined;
          const unchangedRubricGrade =
            Boolean(prev?.rubricEval) &&
            !prev?.manualOverride &&
            prev?.grade !== null &&
            prev?.grade !== undefined &&
            finalGrade !== null &&
            Math.abs(finalGrade - prev.grade) < 1e-6;
          nextCells[k] = {
            grade: finalGrade,
            comment: cleanComment,
            rubricEval: prev?.rubricEval,
            manualOverride: unchangedRubricGrade ? undefined : true,
            pendingAdjustment: resolvePendingOutput(true),
            appliedAdjustment: nextApplied,
            preAdjustmentGrade: nextPre,
          };
        } else {
          delete nextCells[k];
        }
        return;
      }

      // NUMERIC column
      const clampedBaseNumeric = targetGrade !== null ? clampGradeForColumn(targetGrade, col) : null;
      const adjustedNumeric =
        !options?.hasExplicitPendingAdjustment && targetGrade !== null && prevPending
          ? applyCounterDelta(targetGrade, prevPending, col)
          : targetGrade;
      const finalGrade = adjustedNumeric !== null ? clampGradeForColumn(adjustedNumeric, col) : null;
      const nextPending = resolvePendingOutput(finalGrade !== null);
      const nextAppliedNumeric =
        finalGrade !== null
          ? options?.hasExplicitPendingAdjustment
            ? options.appliedAdjustment
            : prevPending
          : undefined;
      const nextPreNumeric =
        finalGrade !== null
          ? options?.hasExplicitPendingAdjustment
            ? options.preAdjustmentGrade
            : prevPending && clampedBaseNumeric !== null
              ? clampedBaseNumeric
              : undefined
          : undefined;
      if (finalGrade === null && !cleanComment && !nextPending) {
        delete nextCells[k];
      } else {
        nextCells[k] = {
          ...prev,
          grade: finalGrade,
          comment: cleanComment,
          pendingAdjustment: nextPending,
          appliedAdjustment: nextAppliedNumeric,
          preAdjustmentGrade: nextPreNumeric,
        };
      }
      return;
    }

    // Folder summary column cell (editable calculated cell with upstream auto-recalc tracking)
    const fldInfo = folderMap.get(targetId);
    if (!fldInfo || fldInfo.tabLocked) return;
    const { folder, childCols } = fldInfo;
    const baseChild = childCols[0];
    const fMin = baseChild ? baseChild.minValue : 0;
    const fMax = baseChild ? baseChild.maxValue : 10;

    if (options?.preserveExistingGrade || (targetGrade === null && cleanComment)) {
      const hasPrevGrade = prev?.grade !== null && prev?.grade !== undefined;
      if (!hasPrevGrade && !prev?.manualOverride && !prev?.autoRecalcNotice && !cleanComment) {
        delete nextCells[k];
      } else {
        nextCells[k] = {
          grade: prev?.grade ?? null,
          comment: cleanComment,
          manualOverride: prev?.manualOverride,
          manualSourceSignature: prev?.manualSourceSignature,
          autoRecalcNotice: prev?.autoRecalcNotice,
        };
      }
    } else if (targetGrade !== null) {
      const clamped = roundTo(Math.max(fMin, Math.min(fMax, targetGrade)), 2);
      nextCells[k] = {
        grade: clamped,
        comment: cleanComment,
        manualOverride: true,
        manualSourceSignature: computeFolderSourceSignature(
          folder,
          childCols,
          studentId,
          bookSnapshot
        ),
        autoRecalcNotice: undefined,
      };
    } else {
      delete nextCells[k];
    }
  };

  const buildBookColumnAndFolderMaps = (book: ClassBook) => {
    const colMap = new Map<string, ColumnEntity>();
    const folderMap = new Map<
      string,
      { folder: FolderEntity; childCols: ColumnEntity[]; tabLocked: boolean }
    >();
    for (const tab of book.tabs) {
      const tabLocked = Boolean(tab.isLocked);
      for (const col of tab.columns) colMap.set(col.id, col);
      for (const folder of tab.folders) {
        const childCols = tab.columns
          .filter((c) => c.folderId === folder.id)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        folderMap.set(folder.id, { folder, childCols, tabLocked });
      }
    }
    return { colMap, folderMap };
  };

  const setCellData = useCallback<GradebookContextValue['setCellData']>(
    (studentId, columnId, grade, comment, options) => {
      mutateActiveBook(
        (book, ws) => {
          const { colMap, folderMap } = buildBookColumnAndFolderMaps(book);
          const nextCells = { ...book.cells };
          applySingleCellInput(
            book,
            nextCells,
            colMap,
            folderMap,
            studentId,
            columnId,
            grade,
            comment,
            options
          );
          return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
        },
        true,
        { studentId, columnId }
      );
    },
    [mutateActiveBook]
  );

  const setCellRubricEval = useCallback<GradebookContextValue['setCellRubricEval']>(
    (studentId, columnId, rubricEval, comment, preserveManualOverride = false) => {
      mutateActiveBook(
        (book, ws) => {
          const k = cellKey(studentId, columnId);
          const prev = book.cells[k];
          const cleanComment = comment !== undefined ? comment.trim() : (prev?.comment ?? '');
          const hasSelections = Object.keys(rubricEval.selections ?? {}).length > 0;
          const keepManual = preserveManualOverride && Boolean(prev?.manualOverride);
          const nextCells = { ...book.cells };

          const keepPending =
            typeof prev?.pendingAdjustment === 'number' && prev.pendingAdjustment !== 0
              ? prev.pendingAdjustment
              : undefined;

          if (!hasSelections && !cleanComment && !keepManual && !keepPending) {
            delete nextCells[k];
          } else {
            nextCells[k] = {
              grade: keepManual ? (prev?.grade ?? null) : null,
              comment: cleanComment,
              rubricEval,
              manualOverride: keepManual ? prev?.manualOverride : undefined,
              ...(keepPending ? { pendingAdjustment: keepPending } : {}),
            };
          }
          return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
        },
        true,
        { studentId, columnId }
      );
    },
    [mutateActiveBook]
  );

  const toggleColumnRubricExpanded = useCallback<
    GradebookContextValue['toggleColumnRubricExpanded']
  >(
    (columnId) => {
      mutateActiveBook((book) => {
        return {
          ...book,
          tabs: book.tabs.map((t) => ({
            ...t,
            columns: t.columns.map((c) =>
              c.id === columnId ? { ...c, rubricExpanded: !c.rubricExpanded } : c
            ),
          })),
        };
      }, false);
    },
    [mutateActiveBook]
  );

  const setRubricCriterionForStudents = useCallback<
    GradebookContextValue['setRubricCriterionForStudents']
  >(
    (studentIds, columnId, rubricId, criterionId, levelId) => {
      if (studentIds.length === 0) return;
      mutateActiveBook(
        (book, ws) => {
          const nextCells = { ...book.cells };
          for (const studentId of studentIds) {
            const k = cellKey(studentId, columnId);
            const prev = nextCells[k];
            const prevSelections = prev?.rubricEval?.selections ?? {};
            const nextSelections: RubricCellEval['selections'] = { ...prevSelections };
            if (levelId) {
              nextSelections[criterionId] = { levelId };
            } else {
              delete nextSelections[criterionId];
            }
            const cleanComment = prev?.comment ?? '';
            const hasSelections = Object.keys(nextSelections).length > 0;
            const keepPending =
              typeof prev?.pendingAdjustment === 'number' && prev.pendingAdjustment !== 0
                ? prev.pendingAdjustment
                : undefined;
            if (!hasSelections && !cleanComment && !keepPending) {
              delete nextCells[k];
            } else {
              nextCells[k] = {
                grade: null,
                comment: cleanComment,
                rubricEval: { rubricId, selections: nextSelections },
                ...(keepPending ? { pendingAdjustment: keepPending } : {}),
              };
            }
          }
          return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
        },
        true,
        studentIds.length === 1 ? { studentId: studentIds[0], columnId } : null
      );
    },
    [mutateActiveBook]
  );

  const setRubricEvalForStudents = useCallback<
    GradebookContextValue['setRubricEvalForStudents']
  >(
    (studentIds, columnId, rubricId, selections, options) => {
      if (studentIds.length === 0) return;
      mutateActiveBook(
        (book, ws) => {
          const nextCells = { ...book.cells };
          const touched = options?.touchedCriteriaIds;
          const cleanBatchComment = options?.comment?.trim();

          for (const studentId of studentIds) {
            const k = cellKey(studentId, columnId);
            const prev = nextCells[k];
            let nextSelections: RubricCellEval['selections'];
            if (touched) {
              nextSelections = { ...(prev?.rubricEval?.selections ?? {}) };
              for (const critId of touched) {
                if (selections[critId]?.levelId) {
                  nextSelections[critId] = { ...selections[critId] };
                } else {
                  delete nextSelections[critId];
                }
              }
            } else {
              nextSelections = structuredClone(selections);
            }

            const cleanComment =
              cleanBatchComment !== undefined && cleanBatchComment.length > 0
                ? cleanBatchComment
                : (prev?.comment ?? '');
            const hasSelections = Object.keys(nextSelections).length > 0;
            const keepPending =
              typeof prev?.pendingAdjustment === 'number' && prev.pendingAdjustment !== 0
                ? prev.pendingAdjustment
                : undefined;

            if (!hasSelections && !cleanComment && !keepPending) {
              delete nextCells[k];
            } else {
              nextCells[k] = {
                grade: null,
                comment: cleanComment,
                rubricEval: { rubricId, selections: nextSelections },
                ...(keepPending ? { pendingAdjustment: keepPending } : {}),
              };
            }
          }
          return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
        },
        true,
        studentIds.length === 1 ? { studentId: studentIds[0], columnId } : null
      );
    },
    [mutateActiveBook]
  );

  const clearCell = useCallback<GradebookContextValue['clearCell']>(
    (studentId, rawColumnId) => {
      const columnId = normalizeCellTargetId(rawColumnId);
      mutateActiveBook(
        (book, ws) => {
          const k = cellKey(studentId, columnId);
          const nextCells = { ...book.cells };
          delete nextCells[k];
          return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
        },
        true,
        { studentId, columnId }
      );
    },
    [mutateActiveBook]
  );

  const setMultipleCellsData = useCallback<GradebookContextValue['setMultipleCellsData']>(
    (targets, grade, comment, options) => {
      if (targets.length === 0) return;
      mutateActiveBook(
        (book, ws) => {
          const { colMap, folderMap } = buildBookColumnAndFolderMaps(book);
          const nextCells = { ...book.cells };

          for (const { studentId, columnId } of targets) {
            applySingleCellInput(
              book,
              nextCells,
              colMap,
              folderMap,
              studentId,
              columnId,
              grade,
              comment,
              options
            );
          }

          return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
        },
        true,
        targets[0]
      );
    },
    [mutateActiveBook]
  );

  const applyCellsBatch = useCallback<GradebookContextValue['applyCellsBatch']>(
    (entries) => {
      if (entries.length === 0) return;
      mutateActiveBook(
        (book, ws) => {
          const { colMap, folderMap } = buildBookColumnAndFolderMaps(book);
          const nextCells = { ...book.cells };

          for (const entry of entries) {
            applySingleCellInput(
              book,
              nextCells,
              colMap,
              folderMap,
              entry.studentId,
              entry.columnId,
              entry.grade,
              entry.comment,
              entry.hasExplicitPendingAdjustment
                ? {
                    hasExplicitPendingAdjustment: true,
                    pendingAdjustment: entry.pendingAdjustment,
                    appliedAdjustment: entry.appliedAdjustment,
                    preAdjustmentGrade: entry.preAdjustmentGrade,
                    keepRubricAuto: entry.keepRubricAuto,
                  }
                : undefined
            );
          }

          return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
        },
        true,
        { studentId: entries[0].studentId, columnId: entries[0].columnId }
      );
    },
    [mutateActiveBook]
  );

  const restoreOriginalGrades = useCallback<GradebookContextValue['restoreOriginalGrades']>(
    (targets) => {
      if (targets.length === 0) return;
      mutateActiveBook(
        (book, ws) => {
          const { colMap } = buildBookColumnAndFolderMaps(book);
          const nextCells = { ...book.cells };
          let changed = false;

          for (const { studentId, columnId } of targets) {
            const col = colMap.get(columnId);
            if (!col || col.isLocked || col.type === 'AVERAGE') continue;
            const k = cellKey(studentId, col.id);
            const prev = nextCells[k];
            if (!prev) continue;

            const hasPending =
              typeof prev.pendingAdjustment === 'number' &&
              Number.isFinite(prev.pendingAdjustment) &&
              prev.pendingAdjustment !== 0;
            const hasApplied =
              typeof prev.appliedAdjustment === 'number' &&
              Number.isFinite(prev.appliedAdjustment) &&
              prev.appliedAdjustment !== 0;
            const hasPre =
              typeof prev.preAdjustmentGrade === 'number' &&
              Number.isFinite(prev.preAdjustmentGrade);

            if (!hasPending && !hasApplied && !hasPre) continue;

            changed = true;
            if (col.type === 'RUBRIC' && prev.rubricEval && !prev.manualOverride) {
              nextCells[k] = {
                grade: prev.grade,
                comment: prev.comment ?? '',
                rubricEval: prev.rubricEval,
              };
            } else if (hasPre) {
              const restoredGrade = clampGradeForColumn(prev.preAdjustmentGrade!, col);
              nextCells[k] = {
                grade: restoredGrade,
                comment: prev.comment ?? '',
                ...(prev.rubricEval ? { rubricEval: prev.rubricEval } : {}),
                ...(prev.manualOverride ? { manualOverride: true } : {}),
              };
            } else if ((prev.comment ?? '').trim() || prev.rubricEval) {
              nextCells[k] = {
                grade: prev.grade,
                comment: prev.comment ?? '',
                ...(prev.rubricEval ? { rubricEval: prev.rubricEval } : {}),
                ...(prev.manualOverride ? { manualOverride: true } : {}),
              };
            } else {
              delete nextCells[k];
            }
          }

          if (!changed) return book;
          return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
        },
        true,
        targets[0]
      );
    },
    [mutateActiveBook]
  );

  const clearMultipleCells = useCallback<GradebookContextValue['clearMultipleCells']>(
    (targets) => {
      if (targets.length === 0) return;
      mutateActiveBook(
        (book, ws) => {
          const { colMap, folderMap } = buildBookColumnAndFolderMaps(book);
          const nextCells = { ...book.cells };
          for (const { studentId, columnId: rawColumnId } of targets) {
            const columnId = normalizeCellTargetId(rawColumnId);
            const col = colMap.get(columnId);
            if (col) {
              if (col.isLocked || col.type === 'AVERAGE') continue;
              delete nextCells[cellKey(studentId, columnId)];
              continue;
            }
            const fld = folderMap.get(columnId);
            if (fld && !fld.tabLocked) {
              delete nextCells[cellKey(studentId, columnId)];
            }
          }
          return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
        },
        true,
        targets[0]
      );
    },
    [mutateActiveBook]
  );

  const clearColumnCells = useCallback<GradebookContextValue['clearColumnCells']>(
    (columnId) => {
      mutateActiveBook((book, ws) => {
        const suffix = `::${columnId}`;
        const nextCells = { ...book.cells };
        let changed = false;
        for (const k of Object.keys(nextCells)) {
          if (k.endsWith(suffix)) {
            delete nextCells[k];
            changed = true;
          }
        }
        if (!changed) return book;
        return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  const fillEmptyGradesWithNP = useCallback<GradebookContextValue['fillEmptyGradesWithNP']>(
    (columnIds) => {
      const ws = workspaceRef.current;
      const currentBook =
        ws.activeMode === 'TEMPLATE'
          ? ws.templates.find((t) => t.id === (ws.activeTemplateId ?? ws.templates[0]?.id))
          : ws.classes.find((c) => c.id === (ws.activeClassId ?? ws.classes[0]?.id));
      if (!currentBook) return { filledCount: 0, affectedColumnCount: 0 };

      const preview = fillColumnsEmptyWithNP(currentBook, columnIds, ws.rubrics);
      if (preview.filledCount === 0) {
        return { filledCount: 0, affectedColumnCount: 0 };
      }

      mutateActiveBook(
        (book, curWs) => fillColumnsEmptyWithNP(book, columnIds, curWs.rubrics).book,
        true,
        preview.firstTarget
      );

      return {
        filledCount: preview.filledCount,
        affectedColumnCount: preview.affectedColumnCount,
      };
    },
    [mutateActiveBook]
  );

  const restoreFolderCellCalculation = useCallback<
    GradebookContextValue['restoreFolderCellCalculation']
  >(
    (studentId, rawFolderId) => {
      const folderId = normalizeCellTargetId(rawFolderId);
      const ws = workspaceRef.current;
      const currentBook =
        ws.activeMode === 'TEMPLATE'
          ? ws.templates.find((t) => t.id === (ws.activeTemplateId ?? ws.templates[0]?.id))
          : ws.classes.find((c) => c.id === (ws.activeClassId ?? ws.classes[0]?.id));
      if (!currentBook) return;
      const preview = restoreFolderCellsCalculation(currentBook, folderId, ws.rubrics, [studentId]);
      if (preview.restoredCount === 0) return;
      mutateActiveBook(
        (book, curWs) => restoreFolderCellsCalculation(book, folderId, curWs.rubrics, [studentId]).book,
        true,
        { studentId, columnId: folderId }
      );
    },
    [mutateActiveBook]
  );

  const restoreFolderCalculation = useCallback<
    GradebookContextValue['restoreFolderCalculation']
  >(
    (folderId) => {
      const ws = workspaceRef.current;
      const currentBook =
        ws.activeMode === 'TEMPLATE'
          ? ws.templates.find((t) => t.id === (ws.activeTemplateId ?? ws.templates[0]?.id))
          : ws.classes.find((c) => c.id === (ws.activeClassId ?? ws.classes[0]?.id));
      if (!currentBook) return 0;
      const preview = restoreFolderCellsCalculation(currentBook, folderId, ws.rubrics);
      if (preview.restoredCount === 0) return 0;
      mutateActiveBook(
        (book, curWs) => restoreFolderCellsCalculation(book, folderId, curWs.rubrics).book,
        true
      );
      return preview.restoredCount;
    },
    [mutateActiveBook]
  );

  const recalculateActiveBook = useCallback(() => {
    mutateActiveBook((book, ws) => recalculateBook(book, ws.rubrics), false);
  }, [mutateActiveBook]);

  // =====================================================================
  // Rubrics CRUD
  // =====================================================================
  const saveRubric = useCallback<GradebookContextValue['saveRubric']>(
    (rubric) => {
      const normalized: RubricEntity = {
        ...rubric,
        levels: normalizeRubricLevels(rubric.levels),
      };
      let saved = normalized;
      commit((prev) => {
        const exists = prev.rubrics.some((r) => r.id === normalized.id);
        let nextRubrics: RubricEntity[];
        if (exists) {
          nextRubrics = prev.rubrics.map((r) => (r.id === normalized.id ? normalized : r));
        } else {
          saved = { ...normalized, id: normalized.id || makeId('rub') };
          nextRubrics = [...prev.rubrics, saved];
        }
        return {
          ...prev,
          rubrics: nextRubrics,
          classes: prev.classes.map((c) => recalculateBook(c, nextRubrics)),
          templates: prev.templates.map((t) => recalculateBook(t, nextRubrics)),
        };
      });
      return saved;
    },
    [commit]
  );

  const deleteRubric = useCallback<GradebookContextValue['deleteRubric']>(
    (rubricId) => {
      commit((prev) => {
        if (prev.rubrics.length <= 1) return prev;
        return {
          ...prev,
          rubrics: prev.rubrics.filter((r) => r.id !== rubricId),
        };
      });
    },
    [commit]
  );

  const setColumnLomloeCriteria = useCallback<
    GradebookContextValue['setColumnLomloeCriteria']
  >(
    (columnId, criteriaIds) => {
      const unique = Array.from(new Set(criteriaIds.filter(Boolean)));
      updateColumn(columnId, { lomloeCriteriaIds: unique });
    },
    [updateColumn]
  );

  const saveLomloeCurriculum = useCallback<
    GradebookContextValue['saveLomloeCurriculum']
  >(
    (curriculum) => {
      commit((prev) => {
        const current =
          prev.lomloeCurricula && prev.lomloeCurricula.length > 0
            ? prev.lomloeCurricula
            : DEFAULT_LOMLOE_RELIGION_CURRICULA;
        const exists = current.some((c) => c.id === curriculum.id);
        const nextCurricula = exists
          ? current.map((c) => (c.id === curriculum.id ? curriculum : c))
          : [...current, curriculum];
        return {
          ...prev,
          lomloeCurricula: nextCurricula,
        };
      });
    },
    [commit]
  );

  const deleteLomloeCurriculum = useCallback<
    GradebookContextValue['deleteLomloeCurriculum']
  >(
    (curriculumId) => {
      commit((prev) => {
        const current =
          prev.lomloeCurricula && prev.lomloeCurricula.length > 0
            ? prev.lomloeCurricula
            : DEFAULT_LOMLOE_RELIGION_CURRICULA;
        if (current.length <= 1) return prev;
        return {
          ...prev,
          lomloeCurricula: current.filter((c) => c.id !== curriculumId),
        };
      });
    },
    [commit]
  );

  const resetDefaultLomloeCurricula = useCallback(() => {
    commit((prev) => ({
      ...prev,
      lomloeKeyCompetences: DEFAULT_LOMLOE_KEY_COMPETENCES.map((kc) => ({ ...kc })),
      lomloeCurricula: DEFAULT_LOMLOE_RELIGION_CURRICULA.map((cur) => ({
        ...cur,
        specificCompetences: cur.specificCompetences.map((ce) => ({
          ...ce,
          keyCompetenceIds: [...ce.keyCompetenceIds],
        })),
        criteria: cur.criteria.map((cr) => ({ ...cr })),
      })),
    }));
  }, [commit]);

  const updateLomloeKeyCompetences = useCallback<
    GradebookContextValue['updateLomloeKeyCompetences']
  >(
    (competences) => {
      commit((prev) => ({
        ...prev,
        lomloeKeyCompetences: competences,
      }));
    },
    [commit]
  );

  const setColumnEducamosStatus = useCallback<
    GradebookContextValue['setColumnEducamosStatus']
  >(
    (columnId, status) => {
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) => ({
          ...t,
          columns: t.columns.map((c) => {
            if (c.id !== columnId) return c;
            if (status === 'PENDING') {
              const next = { ...c };
              delete next.educamos;
              return next;
            }
            return {
              ...c,
              educamos: createEducamosDoneTracking(c, book.students, book.cells),
            };
          }),
        })),
      }));
    },
    [mutateActiveBook]
  );

  const markCellEducamosUpdated = useCallback<
    GradebookContextValue['markCellEducamosUpdated']
  >(
    (studentId, columnId) => {
      mutateActiveBook(
        (book) => ({
          ...book,
          tabs: book.tabs.map((t) => ({
            ...t,
            columns: t.columns.map((c) => {
              if (c.id !== columnId || c.educamos?.status !== 'DONE') return c;
              return {
                ...c,
                educamos: markEducamosCellSynced(
                  c,
                  studentId,
                  book.cells[cellKey(studentId, columnId)]
                ),
              };
            }),
          })),
        }),
        true,
        { studentId, columnId }
      );
    },
    [mutateActiveBook]
  );

  const runAutoBackupWrite = useCallback(async (handle: BackupDirectoryHandle, ws: GradebookWorkspace) => {
    setAutoBackup((prev) => ({ ...prev, status: 'SAVING', error: null }));
    try {
      const meta = await writeBackupToDirectory(handle, ws);
      lastBackedUpUpdatedAtRef.current = meta.lastBackedUpUpdatedAt;
      setAutoBackup((prev) => ({
        ...prev,
        status: 'ACTIVE',
        folderName: meta.folderName ?? handle.name,
        lastSavedAt: meta.lastSavedAt,
        error: null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar la copia en la carpeta.';
      const isPermErr =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setAutoBackup((prev) => ({
        ...prev,
        status: isPermErr ? 'NEEDS_PERMISSION' : 'ERROR',
        error: isPermErr ? null : msg,
      }));
    }
  }, []);

  // Load saved backup directory handle on startup and inspect existing permission
  useEffect(() => {
    if (!isDirectoryPickerSupported()) return;
    let cancelled = false;
    (async () => {
      const handle = await loadBackupDirHandle();
      if (cancelled || !handle) return;
      backupDirHandleRef.current = handle;
      const perm = await queryBackupFolderPermission(handle);
      if (cancelled) return;
      setAutoBackup((prev) => ({
        ...prev,
        supported: true,
        status: perm === 'granted' ? 'ACTIVE' : 'NEEDS_PERMISSION',
        folderName: handle.name || prev.folderName,
        error: null,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Automatically overwrite `Mi Cuaderno.json` in background when data changes or remote sync lands
  useEffect(() => {
    if (!hydrated || autoBackup.status !== 'ACTIVE') return;
    const handle = backupDirHandleRef.current;
    if (!handle) return;
    if (workspace.updatedAt === lastBackedUpUpdatedAtRef.current) return;

    if (autoBackupTimerRef.current) window.clearTimeout(autoBackupTimerRef.current);
    const snapshot = workspace;
    autoBackupTimerRef.current = window.setTimeout(() => {
      autoBackupTimerRef.current = null;
      void runAutoBackupWrite(handle, snapshot);
    }, 1800);

    return () => {
      if (autoBackupTimerRef.current) {
        window.clearTimeout(autoBackupTimerRef.current);
        autoBackupTimerRef.current = null;
      }
    };
  }, [hydrated, autoBackup.status, workspace, runAutoBackupWrite]);

  // Flush pending local file backup if user hides/leaves tab right after editing
  useEffect(() => {
    const flushPendingBackup = () => {
      if (autoBackupTimerRef.current && backupDirHandleRef.current) {
        window.clearTimeout(autoBackupTimerRef.current);
        autoBackupTimerRef.current = null;
        void writeBackupToDirectory(backupDirHandleRef.current, workspaceRef.current)
          .then((meta) => {
            lastBackedUpUpdatedAtRef.current = meta.lastBackedUpUpdatedAt;
          })
          .catch(() => {
            // ignore background flush failure on unload
          });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPendingBackup();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const configureAutoBackupFolder = useCallback(async (): Promise<boolean> => {
    if (!isDirectoryPickerSupported()) return false;
    try {
      const handle = await pickBackupFolder();
      if (!handle) return false;
      backupDirHandleRef.current = handle;
      await runAutoBackupWrite(handle, workspaceRef.current);
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false;
      }
      setAutoBackup((prev) => ({
        ...prev,
        status: backupDirHandleRef.current ? 'ERROR' : 'UNCONFIGURED',
        error: err instanceof Error ? err.message : 'No se pudo configurar la carpeta de copias.',
      }));
      return false;
    }
  }, [runAutoBackupWrite]);

  const reactivateAutoBackup = useCallback(async (): Promise<boolean> => {
    const handle = backupDirHandleRef.current ?? (await loadBackupDirHandle());
    if (!handle) {
      return configureAutoBackupFolder();
    }
    backupDirHandleRef.current = handle;
    const perm = await ensureBackupFolderPermission(handle, true);
    if (perm === 'granted') {
      await runAutoBackupWrite(handle, workspaceRef.current);
      return true;
    }
    setAutoBackup((prev) => ({
      ...prev,
      status: 'NEEDS_PERMISSION',
      folderName: handle.name || prev.folderName,
    }));
    return false;
  }, [configureAutoBackupFolder, runAutoBackupWrite]);

  const disableAutoBackupFolder = useCallback(async (): Promise<void> => {
    if (autoBackupTimerRef.current) {
      window.clearTimeout(autoBackupTimerRef.current);
      autoBackupTimerRef.current = null;
    }
    backupDirHandleRef.current = null;
    lastBackedUpUpdatedAtRef.current = null;
    await clearBackupDirHandle();
    setAutoBackup({
      supported: isDirectoryPickerSupported(),
      status: isDirectoryPickerSupported() ? 'UNCONFIGURED' : 'UNSUPPORTED',
      folderName: null,
      lastSavedAt: null,
      error: null,
    });
  }, []);

  const saveManualBackup = useCallback(async (): Promise<'FOLDER' | 'DOWNLOAD'> => {
    const handle = backupDirHandleRef.current ?? (await loadBackupDirHandle());
    if (handle) {
      backupDirHandleRef.current = handle;
      const perm = await ensureBackupFolderPermission(handle, true);
      if (perm === 'granted') {
        await runAutoBackupWrite(handle, workspaceRef.current);
        return 'FOLDER';
      }
    }
    downloadBackupFile(workspaceRef.current);
    const meta = loadLocalBackupMeta();
    setAutoBackup((prev) => ({
      ...prev,
      lastSavedAt: meta.lastSavedAt,
    }));
    return 'DOWNLOAD';
  }, [runAutoBackupWrite]);

  const loadDemoData = useCallback(() => {
    const seeded = createSeedWorkspace();
    setUndoStack([]);
    dataMutationSeqRef.current += 1;
    markLocalDirty();
    setWorkspace(seeded);
    saveLocalWorkspace(seeded);
  }, [markLocalDirty]);

  const restoreBackup = useCallback<GradebookContextValue['restoreBackup']>((backup) => {
    const hydrated = hydrateWorkspace(backup);
    if (!hydrated) {
      throw new Error('El archivo no contiene un formato válido de copia de seguridad del cuaderno.');
    }
    const validated: GradebookWorkspace = {
      ...hydrated,
      settings: {
        ...createSeedWorkspace().settings,
        ...(hydrated.settings || {}),
      },
      updatedAt: new Date().toISOString(),
    };
    setUndoStack([]);
    dataMutationSeqRef.current += 1;
    markLocalDirty();
    setWorkspace(validated);
    saveLocalWorkspace(validated);
  }, [markLocalDirty]);

  const resetAll = useCallback(() => {
    const seeded = createSeedWorkspace();
    const blankClsId = makeId('cls');
    const blankTabId = makeId('tab');
    const blankWs: GradebookWorkspace = {
      ...seeded,
      activeMode: 'CLASS',
      activeClassId: blankClsId,
      activeTabByBook: { [blankClsId]: blankTabId },
      classes: [
        {
          id: blankClsId,
          name: 'Mi Clase',
          subject: 'Asignatura',
          year: '2026-2027',
          color: '#3B82F6',
          passThreshold: 5,
          sortMode: 'LAST_ASC',
          students: [],
          tabs: [
            {
              id: blankTabId,
              title: '1.ª Evaluación',
              color: '#DBEAFE',
              orderIndex: 0,
              folders: [],
              columns: [
                {
                  id: makeId('col'),
                  folderId: null,
                  title: 'Actividad 1',
                  color: '#DBEAFE',
                  width: 80,
                  orderIndex: 0,
                  type: 'NUMERIC',
                  minValue: 0,
                  maxValue: 10,
                  decimals: 2,
                  passThreshold: 5,
                  colorMode: 'CELL_BG',
                },
              ],
            },
          ],
          cells: {},
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    setUndoStack([]);
    clearLocalWorkspace().then(() => {
      setWorkspace(blankWs);
      saveLocalWorkspace(blankWs);
    });
  }, []);

  const value: GradebookContextValue = {
    workspace,
    activeBook,
    activeTab,
    isTemplateMode,
    user,
    authLoading,
    syncStatus,
    syncError,
    isOnline,
    hasPendingSync,
    syncConflicts,
    syncNotice,
    isFirebaseConfigured,
    signInWithEmail,
    sendPasswordReset,
    signInWithGoogle,
    signOutGoogle,
    pushLocalToCloud,
    reconcileCloudNow,
    resolveSyncConflict,
    dismissSyncConflicts,
    setActiveMode,
    selectClass,
    selectTemplate,
    selectTab,
    updateSettings,
    canUndo: undoStack.length > 0,
    undo,
    lastUndoneTarget,
    canUndoAspect: aspectUndoStack.length > 0,
    undoAspect,
    beginAspectChange,
    createBook,
    updateBook,
    deleteBook,
    instantiateTemplateAsClass,
    saveBookAsTemplate,
    applyTemplateTabsToClass,
    copyColumnToTarget,
    copyColumnsToTarget,
    copyFolderToTarget,
    copyTabToTarget,
    addTab,
    updateTab,
    duplicateTab,
    deleteTab,
    reorderTabs,
    addFolder,
    updateFolder,
    toggleFolderCollapse,
    deleteFolder,
    stepFolder,
    resizeFolder,
    addColumn,
    updateColumn,
    deleteColumn,
    clearColumnCells,
    duplicateColumn,
    resizeColumn,
    reorderColumn,
    moveItemInActiveTab,
    stepColumn,
    moveColumnToFolder,
    moveColumnToTab,
    applyUniformColumnWidth,
    applyUniformFolderWidth,
    addSummaryRow,
    updateGlobalSummaryRow,
    removeSummaryRow,
    setColumnSummaryOverride,
    addGroupSummaryRow,
    updateGlobalGroupSummaryRow,
    removeGroupSummaryRow,
    setColumnGroupSummaryOverride,
    addStudent,
    bulkImportStudents,
    updateStudent,
    deleteStudent,
    reorderStudents,
    createGroupCategory,
    renameGroupCategory,
    deleteGroupCategory,
    selectGroupCategory,
    upsertStudentGroup,
    deleteStudentGroup,
    reorderStudentGroups,
    assignStudentsToGroup,
    toggleGroupCollapsed,
    setCellData,
    setMultipleCellsData,
    applyCellsBatch,
    restoreOriginalGrades,
    setCellRubricEval,
    toggleColumnRubricExpanded,
    setRubricCriterionForStudents,
    setRubricEvalForStudents,
    clearCell,
    clearMultipleCells,
    fillEmptyGradesWithNP,
    restoreFolderCellCalculation,
    restoreFolderCalculation,
    recalculateActiveBook,
    saveRubric,
    deleteRubric,
    setColumnLomloeCriteria,
    saveLomloeCurriculum,
    deleteLomloeCurriculum,
    resetDefaultLomloeCurricula,
    updateLomloeKeyCompetences,
    setColumnEducamosStatus,
    markCellEducamosUpdated,
    autoBackup,
    configureAutoBackupFolder,
    reactivateAutoBackup,
    disableAutoBackupFolder,
    saveManualBackup,
    loadDemoData,
    restoreBackup,
    resetAll,
  };

  return <GradebookContext.Provider value={value}>{children}</GradebookContext.Provider>;
};

export function useGradebook(): GradebookContextValue {
  const ctx = useContext(GradebookContext);
  if (!ctx) throw new Error('useGradebook debe usarse dentro de GradebookProvider');
  return ctx;
}
