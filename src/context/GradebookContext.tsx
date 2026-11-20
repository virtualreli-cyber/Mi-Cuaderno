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
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
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
  cloneFolderWithColumns,
  cloneSingleColumn,
  cloneTabEntity,
  cloneTabsWithRemappedIds,
  createClassBookFromTemplate,
} from '../engine/cloneHelpers';
import {
  clampGradeForColumn,
  ensureGroupCategories,
  getEffectiveBookGroups,
  makeId,
  normalizeRubricLevels,
  recalculateBook,
} from '../engine/gradeMath';
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
  clearLocalWorkspace,
  loadFirebaseWorkspace,
  loadLocalWorkspace,
  saveFirebaseWorkspace,
  saveLocalWorkspace,
  subscribeFirebaseWorkspace,
} from '../services/storage';
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

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';

interface GradebookContextValue {
  workspace: GradebookWorkspace;
  activeBook: ClassBook | null;
  activeTab: TabEntity | null;
  isTemplateMode: boolean;

  // Auth & Firebase Sync
  user: User | null;
  authLoading: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  isFirebaseConfigured: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutGoogle: () => Promise<void>;
  pushLocalToCloud: () => Promise<void>;

  // Navigation & Settings
  setActiveMode: (mode: 'CLASS' | 'TEMPLATE') => void;
  selectClass: (classId: string) => void;
  selectTemplate: (templateId: string) => void;
  selectTab: (tabId: string) => void;
  updateSettings: (patch: Partial<ViewSettings>) => void;

  // Undo
  canUndo: boolean;
  undo: () => void;

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
  applyUniformColumnWidth: (width: number, scope?: 'TAB' | 'BOOK') => void;
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
    options?: { preserveExistingGrade?: boolean; preserveExistingComment?: boolean }
  ) => void;
  setMultipleCellsData: (
    targets: Array<{ studentId: string; columnId: string }>,
    grade: number | null,
    comment: string,
    options?: { preserveExistingGrade?: boolean; preserveExistingComment?: boolean }
  ) => void;
  applyCellsBatch: (
    entries: Array<{ studentId: string; columnId: string; grade: number | null; comment: string }>
  ) => void;
  setCellRubricEval: (
    studentId: string,
    columnId: string,
    rubricEval: RubricCellEval,
    comment?: string,
    preserveManualOverride?: boolean
  ) => void;
  clearCell: (studentId: string, columnId: string) => void;
  clearMultipleCells: (targets: Array<{ studentId: string; columnId: string }>) => void;

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

  // Demo, Backup & Reset
  loadDemoData: () => void;
  restoreBackup: (backup: GradebookWorkspace) => void;
  resetAll: () => void;
}

const GradebookContext = createContext<GradebookContextValue | null>(null);

export const GradebookProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [workspace, setWorkspace] = useState<GradebookWorkspace>(() => createSeedWorkspace());
  const [hydrated, setHydrated] = useState(false);
  const [undoStack, setUndoStack] = useState<GradebookWorkspace[]>([]);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(isFirebaseConfigured);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('local');
  const [syncError, setSyncError] = useState<string | null>(null);

  const cloudWriteTimer = useRef<number | null>(null);
  const lastRemoteUpdatedAtRef = useRef<string | null>(null);
  const lastWrittenUpdatedAtRef = useRef<string | null>(null);
  const cloudReadyRef = useRef(false);
  const workspaceRef = useRef<GradebookWorkspace>(workspace);
  workspaceRef.current = workspace;

  // Hydrate offline workspace immediately
  useEffect(() => {
    let alive = true;
    loadLocalWorkspace().then((local) => {
      if (!alive) return;
      if (local && local.classes.length > 0) {
        setWorkspace(local);
        workspaceRef.current = local;
      }
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Optional Firebase Auth + Realtime Sync
  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseAuth) {
      setAuthLoading(false);
      setSyncStatus('local');
      return;
    }

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
        setSyncStatus('local');
        setSyncError(null);
        return;
      }

      setSyncStatus('syncing');
      try {
        const remote = await loadFirebaseWorkspace(nextUser.uid);
        if (remote && remote.classes.length > 0) {
          lastRemoteUpdatedAtRef.current = remote.updatedAt;
          lastWrittenUpdatedAtRef.current = remote.updatedAt;
          setWorkspace(remote);
          workspaceRef.current = remote;
          await saveLocalWorkspace(remote);
        } else {
          // Upload latest local data on first sign-in when remote branch is empty
          const localLatest = (await loadLocalWorkspace()) ?? workspaceRef.current;
          lastWrittenUpdatedAtRef.current = localLatest.updatedAt;
          setWorkspace(localLatest);
          workspaceRef.current = localLatest;
          await saveFirebaseWorkspace(nextUser.uid, localLatest);
        }
        cloudReadyRef.current = true;
        setSyncStatus('synced');
        setSyncError(null);

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
            lastRemoteUpdatedAtRef.current = remoteWs.updatedAt;
            setWorkspace(remoteWs);
            workspaceRef.current = remoteWs;
            saveLocalWorkspace(remoteWs);
            setSyncStatus('synced');
          },
          (err) => {
            setSyncStatus('error');
            setSyncError(err.message);
          }
        );
      } catch (err) {
        setSyncStatus('error');
        setSyncError(err instanceof Error ? err.message : 'Error de sincronización');
      }
    });

    return () => {
      unsubAuth();
      if (unsubDb) unsubDb();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save locally & debounce cloud sync
  useEffect(() => {
    if (!hydrated) return;
    saveLocalWorkspace(workspace);

    if (user && isFirebaseConfigured && cloudReadyRef.current) {
      // Skip redundant write-back when state was just applied from RTDB
      if (
        workspace.updatedAt === lastRemoteUpdatedAtRef.current ||
        workspace.updatedAt === lastWrittenUpdatedAtRef.current
      ) {
        return;
      }

      if (cloudWriteTimer.current) window.clearTimeout(cloudWriteTimer.current);
      setSyncStatus('syncing');
      const snapshot = workspace;
      cloudWriteTimer.current = window.setTimeout(async () => {
        try {
          lastWrittenUpdatedAtRef.current = snapshot.updatedAt;
          await saveFirebaseWorkspace(user.uid, snapshot);
          setSyncStatus('synced');
          setSyncError(null);
        } catch (err) {
          setSyncStatus('error');
          setSyncError(err instanceof Error ? err.message : 'Error al guardar en la nube');
        }
      }, 450);
    }
  }, [workspace, hydrated, user]);

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

  const commit = useCallback(
    (updater: (prev: GradebookWorkspace) => GradebookWorkspace, recordUndo = true) => {
      setWorkspace((prev) => {
        if (recordUndo) {
          setUndoStack((s) => [...s.slice(-39), prev]);
        }
        return {
          ...updater(prev),
          updatedAt: new Date().toISOString(),
        };
      });
    },
    []
  );

  const mutateActiveBook = useCallback(
    (mutator: (book: ClassBook, ws: GradebookWorkspace) => ClassBook, recordUndo = true) => {
      commit((prev) => {
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
      }, recordUndo);
    },
    [commit]
  );

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setWorkspace(previous);
      return stack.slice(0, -1);
    });
  }, []);

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
    await signInWithPopup(firebaseAuth, googleAuthProvider);
  }, []);

  const signOutGoogle = useCallback(async () => {
    if (!firebaseAuth) return;
    await signOut(firebaseAuth);
  }, []);

  const pushLocalToCloud = useCallback(async () => {
    if (!user || !isFirebaseConfigured) return;
    setSyncStatus('syncing');
    try {
      lastWrittenUpdatedAtRef.current = workspace.updatedAt;
      await saveFirebaseWorkspace(user.uid, workspace);
      setSyncStatus('synced');
      setSyncError(null);
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err instanceof Error ? err.message : 'Error al sincronizar');
    }
  }, [user, workspace]);

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
      commit((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }), false);
    },
    [commit]
  );

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
                width: 118,
                orderIndex: 0,
                type: 'NUMERIC',
                minValue: 0,
                maxValue: 10,
                decimals: 2,
                passThreshold: 5,
                colorMode: 'NONE',
              },
            ],
          },
        ],
        cells: {},
      };

      commit((prev) => ({
        ...prev,
        activeMode: kind,
        activeClassId: isTpl ? prev.activeClassId : bookId,
        activeTemplateId: isTpl ? bookId : prev.activeTemplateId,
        activeTabByBook: { ...prev.activeTabByBook, [bookId]: tabId },
        classes: isTpl ? prev.classes : [...prev.classes, newBook],
        templates: isTpl ? [...prev.templates, newBook] : prev.templates,
      }));
      return newBook;
    },
    [commit]
  );

  const updateBook = useCallback<GradebookContextValue['updateBook']>(
    (bookId, patch) => {
      commit((prev) => ({
        ...prev,
        classes: prev.classes.map((c) => (c.id === bookId ? { ...c, ...patch } : c)),
        templates: prev.templates.map((t) => (t.id === bookId ? { ...t, ...patch } : t)),
      }));
    },
    [commit]
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
        classes: [...prev.classes, newCls],
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
        templates: [...prev.templates, tpl],
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
            width: 118,
            orderIndex: 0,
            type: 'NUMERIC',
            minValue: 0,
            maxValue: 10,
            decimals: 2,
            passThreshold: activeBook.passThreshold,
            colorMode: 'NONE',
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
        orderIndex: activeTab.folders.length,
        isCollapsed: false,
        summaryMode: 'ARITHMETIC_MEAN',
        ignoreEmpty: true,
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
      mutateActiveBook((book) => ({
        ...book,
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
      }));
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
    },
    [mutateActiveBook]
  );

  const resizeFolder = useCallback<GradebookContextValue['resizeFolder']>(
    (tabId, folderId, width) => {
      const clamped = Math.max(38, Math.min(280, Math.round(width)));
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
    },
    [mutateActiveBook]
  );

  // =====================================================================
  // Bottom Summary Rows (as many as desired / all summary options)
  // =====================================================================
  const addSummaryRow = useCallback<GradebookContextValue['addSummaryRow']>(
    (metric) => {
      mutateActiveBook((book) => {
        const current = book.summaryRows ?? (['MEAN', 'PASS_PCT'] as ColumnSummaryMetric[]);
        if (current.length >= 25) return book;
        return {
          ...book,
          summaryRows: [...current, metric],
        };
      });
    },
    [mutateActiveBook]
  );

  const updateGlobalSummaryRow = useCallback<GradebookContextValue['updateGlobalSummaryRow']>(
    (rowIndex, metric, clearColumnOverrides = false) => {
      mutateActiveBook((book) => {
        const current = [...(book.summaryRows ?? (['MEAN', 'PASS_PCT'] as ColumnSummaryMetric[]))];
        if (rowIndex < 0 || rowIndex >= 25) return book;
        while (current.length <= rowIndex) current.push('NONE');
        current[rowIndex] = metric;

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
      });
    },
    [mutateActiveBook]
  );

  const removeSummaryRow = useCallback<GradebookContextValue['removeSummaryRow']>(
    (rowIndex) => {
      mutateActiveBook((book) => {
        const current = [...(book.summaryRows ?? (['MEAN', 'PASS_PCT'] as ColumnSummaryMetric[]))];
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
        };
      });
    },
    [mutateActiveBook]
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
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) =>
          scope === 'BOOK' || t.id === tabId
            ? {
                ...t,
                columns: t.columns.map((c) => ({ ...c, width: clamped })),
              }
            : t
        ),
      }));
      updateSettings({ defaultColumnWidth: clamped });
    },
    [activeTab?.id, mutateActiveBook, updateSettings]
  );

  const applyUniformFolderWidth = useCallback<GradebookContextValue['applyUniformFolderWidth']>(
    (width, scope = 'TAB') => {
      const clamped = Math.max(38, Math.min(280, Math.round(width)));
      const tabId = activeTab?.id;
      mutateActiveBook((book) => ({
        ...book,
        tabs: book.tabs.map((t) =>
          scope === 'BOOK' || t.id === tabId
            ? {
                ...t,
                folders: t.folders.map((f) => ({ ...f, width: clamped })),
              }
            : t
        ),
      }));
      updateSettings({ defaultFolderWidth: clamped });
    },
    [activeTab?.id, mutateActiveBook, updateSettings]
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
      mutateActiveBook((book, ws) =>
        recalculateBook({ ...book, students: [...book.students, st] }, ws.rubrics)
      );
      return st;
    },
    [activeBook, mutateActiveBook]
  );

  const bulkImportStudents = useCallback<GradebookContextValue['bulkImportStudents']>(
    (incoming, mode) => {
      if (!activeBook || incoming.length === 0) return;
      mutateActiveBook((book, ws) => {
        let nextStudents: StudentEntity[];
        if (mode === 'REPLACE') {
          nextStudents = incoming.map((s, idx) => ({
            id: makeId('st'),
            firstName: s.firstName,
            lastName: s.lastName,
            group: s.group,
            tags: [],
            orderIndex: idx,
          }));
        } else {
          const startIndex = book.students.length;
          const newStudents = incoming.map((s, idx) => ({
            id: makeId('st'),
            firstName: s.firstName,
            lastName: s.lastName,
            group: s.group,
            tags: [],
            orderIndex: startIndex + idx,
          }));
          nextStudents = [...book.students, ...newStudents];
        }
        return recalculateBook({ ...book, students: nextStudents }, ws.rubrics);
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
        return recalculateBook(
          {
            ...book,
            students: book.students.filter((s) => s.id !== studentId),
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
      });
    },
    [mutateActiveBook]
  );

  // =====================================================================
  // Cells CRUD
  // =====================================================================
  const applySingleCellInput = (
    nextCells: Record<string, ClassBook['cells'][string]>,
    col: ColumnEntity | undefined,
    studentId: string,
    grade: number | null,
    comment: string,
    options?: { preserveExistingGrade?: boolean; preserveExistingComment?: boolean }
  ) => {
    if (!col || col.isLocked || col.type === 'AVERAGE') return;
    const k = cellKey(studentId, col.id);
    const prev = nextCells[k];

    let cleanComment = comment.trim();
    if (options?.preserveExistingComment && prev?.comment) {
      cleanComment = prev.comment;
    }

    let targetGrade = grade;
    if (options?.preserveExistingGrade && prev?.grade !== null && prev?.grade !== undefined) {
      targetGrade = prev.grade;
    }

    if (col.type === 'RUBRIC') {
      if (targetGrade === null && cleanComment) {
        // Pure comment typed on a RUBRIC cell: keep existing grade, rubricEval & manualOverride untouched!
        nextCells[k] = {
          grade: prev?.grade ?? null,
          comment: cleanComment,
          rubricEval: prev?.rubricEval,
          manualOverride: prev?.manualOverride,
        };
      } else if (targetGrade !== null) {
        // Explicit numeric grade typed/pasted on a RUBRIC cell:
        const finalGrade = clampGradeForColumn(targetGrade, col);
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
        };
      } else {
        // Both empty -> clear cell
        delete nextCells[k];
      }
      return;
    }

    // NUMERIC column
    const finalGrade = targetGrade !== null ? clampGradeForColumn(targetGrade, col) : null;
    if (finalGrade === null && !cleanComment) {
      delete nextCells[k];
    } else {
      nextCells[k] = {
        ...prev,
        grade: finalGrade,
        comment: cleanComment,
      };
    }
  };

  const setCellData = useCallback<GradebookContextValue['setCellData']>(
    (studentId, columnId, grade, comment, options) => {
      mutateActiveBook((book, ws) => {
        const col = book.tabs.flatMap((t) => t.columns).find((c) => c.id === columnId);
        const nextCells = { ...book.cells };
        applySingleCellInput(nextCells, col, studentId, grade, comment, options);
        return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  const setCellRubricEval = useCallback<GradebookContextValue['setCellRubricEval']>(
    (studentId, columnId, rubricEval, comment, preserveManualOverride = false) => {
      mutateActiveBook((book, ws) => {
        const k = cellKey(studentId, columnId);
        const prev = book.cells[k];
        const nextCells = {
          ...book.cells,
          [k]: {
            grade: prev?.grade ?? null,
            comment: comment !== undefined ? comment.trim() : (prev?.comment ?? ''),
            rubricEval,
            manualOverride: preserveManualOverride ? prev?.manualOverride : undefined,
          },
        };
        return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  const clearCell = useCallback<GradebookContextValue['clearCell']>(
    (studentId, columnId) => {
      mutateActiveBook((book, ws) => {
        const k = cellKey(studentId, columnId);
        const nextCells = { ...book.cells };
        delete nextCells[k];
        return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  const setMultipleCellsData = useCallback<GradebookContextValue['setMultipleCellsData']>(
    (targets, grade, comment, options) => {
      if (targets.length === 0) return;
      mutateActiveBook((book, ws) => {
        const colMap = new Map<string, ColumnEntity>();
        for (const tab of book.tabs) {
          for (const col of tab.columns) colMap.set(col.id, col);
        }
        const nextCells = { ...book.cells };

        for (const { studentId, columnId } of targets) {
          applySingleCellInput(nextCells, colMap.get(columnId), studentId, grade, comment, options);
        }

        return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  const applyCellsBatch = useCallback<GradebookContextValue['applyCellsBatch']>(
    (entries) => {
      if (entries.length === 0) return;
      mutateActiveBook((book, ws) => {
        const colMap = new Map<string, ColumnEntity>();
        for (const tab of book.tabs) {
          for (const col of tab.columns) colMap.set(col.id, col);
        }
        const nextCells = { ...book.cells };

        for (const entry of entries) {
          applySingleCellInput(
            nextCells,
            colMap.get(entry.columnId),
            entry.studentId,
            entry.grade,
            entry.comment
          );
        }

        return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
      });
    },
    [mutateActiveBook]
  );

  const clearMultipleCells = useCallback<GradebookContextValue['clearMultipleCells']>(
    (targets) => {
      if (targets.length === 0) return;
      mutateActiveBook((book, ws) => {
        const colMap = new Map<string, ColumnEntity>();
        for (const tab of book.tabs) {
          for (const col of tab.columns) colMap.set(col.id, col);
        }
        const nextCells = { ...book.cells };
        for (const { studentId, columnId } of targets) {
          const col = colMap.get(columnId);
          if (!col || col.isLocked || col.type === 'AVERAGE') continue;
          delete nextCells[cellKey(studentId, columnId)];
        }
        return recalculateBook({ ...book, cells: nextCells }, ws.rubrics);
      });
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

  const loadDemoData = useCallback(() => {
    const seeded = createSeedWorkspace();
    setUndoStack([]);
    setWorkspace(seeded);
    saveLocalWorkspace(seeded);
  }, []);

  const restoreBackup = useCallback<GradebookContextValue['restoreBackup']>((backup) => {
    if (!backup || !Array.isArray(backup.classes)) {
      throw new Error('El archivo no contiene un formato válido de copia de seguridad del cuaderno.');
    }
    const validated: GradebookWorkspace = {
      version: backup.version || 1,
      classes: backup.classes || [],
      templates: backup.templates || [],
      activeMode: backup.activeMode || 'CLASS',
      activeClassId: backup.activeClassId || backup.classes[0]?.id || null,
      activeTemplateId: backup.activeTemplateId || null,
      activeTabByBook: backup.activeTabByBook || {},
      rubrics: backup.rubrics || [],
      lomloeKeyCompetences:
        backup.lomloeKeyCompetences && backup.lomloeKeyCompetences.length > 0
          ? backup.lomloeKeyCompetences
          : DEFAULT_LOMLOE_KEY_COMPETENCES,
      lomloeCurricula:
        backup.lomloeCurricula && backup.lomloeCurricula.length > 0
          ? backup.lomloeCurricula
          : DEFAULT_LOMLOE_RELIGION_CURRICULA,
      settings: {
        ...createSeedWorkspace().settings,
        ...(backup.settings || {}),
      },
      updatedAt: new Date().toISOString(),
    };
    setUndoStack([]);
    setWorkspace(validated);
    saveLocalWorkspace(validated);
  }, []);

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
                  width: 118,
                  orderIndex: 0,
                  type: 'NUMERIC',
                  minValue: 0,
                  maxValue: 10,
                  decimals: 2,
                  passThreshold: 5,
                  colorMode: 'NONE',
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
    isFirebaseConfigured,
    signInWithEmail,
    sendPasswordReset,
    signInWithGoogle,
    signOutGoogle,
    pushLocalToCloud,
    setActiveMode,
    selectClass,
    selectTemplate,
    selectTab,
    updateSettings,
    canUndo: undoStack.length > 0,
    undo,
    createBook,
    updateBook,
    deleteBook,
    instantiateTemplateAsClass,
    saveBookAsTemplate,
    applyTemplateTabsToClass,
    copyColumnToTarget,
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
    setCellRubricEval,
    clearCell,
    clearMultipleCells,
    saveRubric,
    deleteRubric,
    setColumnLomloeCriteria,
    saveLomloeCurriculum,
    deleteLomloeCurriculum,
    resetDefaultLomloeCurricula,
    updateLomloeKeyCompetences,
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
