import { get, onValue, ref, set, type Unsubscribe } from 'firebase/database';
import { firebaseDb, isFirebaseConfigured } from '../config/firebase';
import {
  DEFAULT_LOMLOE_KEY_COMPETENCES,
  DEFAULT_LOMLOE_RELIGION_CURRICULA,
} from '../data/lomloeReligion';
import { migrateRedundantFolderAverageColumns, recalculateBook } from '../engine/gradeMath';
import type {
  CellEntity,
  ClassBook,
  ColumnSummaryMetric,
  GradebookWorkspace,
  GroupCategoryDef,
  LomloeCriterion,
  LomloeCurriculum,
  LomloeKeyCompetenceDef,
  LomloeSpecificCompetence,
  RubricCriterion,
  RubricLevel,
  StudentGroupDef,
} from '../types/gradebook';

const LOCAL_KEY = 'cuaderno_profesor_v3_workspace';
const IDB_NAME = 'cuaderno_profesor_v3_db';
const IDB_STORE = 'workspaces';
const IDB_KEY = 'primary';

const rtdbWorkspacePath = (uid: string) => `cuaderno_profesor/${uid}/workspace`;

function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter((v): v is T => v !== undefined && v !== null);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, T>).filter(
      (v): v is T => v !== undefined && v !== null
    );
  }
  return [];
}

export function sanitizeForRtdb<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => sanitizeForRtdb(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) {
      out[k] = sanitizeForRtdb(v);
    }
  }
  return out as T;
}

function hydrateCells(rawCells: Record<string, CellEntity> | undefined): Record<string, CellEntity> {
  if (!rawCells || typeof rawCells !== 'object') return {};
  const out: Record<string, CellEntity> = {};
  for (const [k, cell] of Object.entries(rawCells)) {
    if (!cell || typeof cell !== 'object') continue;
    out[k] = {
      grade: typeof cell.grade === 'number' ? cell.grade : null,
      comment: typeof cell.comment === 'string' ? cell.comment : '',
      rubricEval: cell.rubricEval
        ? {
            rubricId: cell.rubricEval.rubricId,
            selections: cell.rubricEval.selections ?? {},
          }
        : undefined,
      manualOverride: cell.manualOverride ? true : undefined,
    };
  }
  return out;
}

function hydrateBook(
  book: ClassBook,
  rubrics: GradebookWorkspace['rubrics'],
  isTemplate = false
): ClassBook {
  const hydrated: ClassBook = {
    ...book,
    isTemplate: isTemplate || Boolean(book.isTemplate),
    passThreshold: book.passThreshold ?? 5,
    sortMode: book.sortMode ?? 'LAST_ASC',
    groupByGroups: Boolean(book.groupByGroups),
    groups: book.groups ? toArray<StudentGroupDef>(book.groups) : undefined,
    groupCategories: book.groupCategories
      ? toArray<GroupCategoryDef>(book.groupCategories).map((cat) => ({
          ...cat,
          groups: toArray<StudentGroupDef>(cat.groups),
          assignments: cat.assignments ?? {},
          studentOrder: cat.studentOrder ?? undefined,
        }))
      : undefined,
    activeGroupCategoryId: book.activeGroupCategoryId ?? undefined,
    groupSpacerRows: typeof book.groupSpacerRows === 'number' ? book.groupSpacerRows : undefined,
    collapsedGroups: book.collapsedGroups ? toArray<string>(book.collapsedGroups) : undefined,
    summaryRows: book.summaryRows ? toArray<ColumnSummaryMetric>(book.summaryRows) : undefined,
    groupSummaryRows: book.groupSummaryRows
      ? toArray<ColumnSummaryMetric>(book.groupSummaryRows)
      : undefined,
    lomloeCurriculumId:
      book.lomloeCurriculumId !== undefined ? book.lomloeCurriculumId : undefined,
    showLomloeRow:
      typeof book.showLomloeRow === 'boolean' ? book.showLomloeRow : undefined,
    students: toArray<ClassBook['students'][number]>(book.students).map((s, idx) => ({
      ...s,
      tags: toArray<string>(s.tags),
      orderIndex: typeof s.orderIndex === 'number' ? s.orderIndex : idx,
      isHidden: Boolean(s.isHidden),
    })),
    tabs: toArray<ClassBook['tabs'][number]>(book.tabs).map((t, tIdx) => ({
      ...t,
      orderIndex: typeof t.orderIndex === 'number' ? t.orderIndex : tIdx,
      isLocked: Boolean(t.isLocked),
      itemOrder: t.itemOrder ? toArray<string>(t.itemOrder) : undefined,
      folders: toArray<ClassBook['tabs'][number]['folders'][number]>(t.folders).map((f, fIdx) => ({
        ...f,
        width: typeof f.width === 'number' ? f.width : undefined,
        orderIndex: typeof f.orderIndex === 'number' ? f.orderIndex : fIdx,
        isCollapsed: Boolean(f.isCollapsed),
        summaryMode: f.summaryMode ?? 'ARITHMETIC_MEAN',
        ignoreEmpty: f.ignoreEmpty ?? true,
        columnWeights: f.columnWeights ?? undefined,
        colorMode: f.colorMode ?? undefined,
        summaryRowOverrides: f.summaryRowOverrides ?? undefined,
        groupSummaryRowOverrides: f.groupSummaryRowOverrides ?? undefined,
      })),
      columns: toArray<ClassBook['tabs'][number]['columns'][number]>(t.columns).map((c, cIdx) => ({
        ...c,
        folderId: c.folderId ?? null,
        orderIndex: typeof c.orderIndex === 'number' ? c.orderIndex : cIdx,
        width: typeof c.width === 'number' ? c.width : 108,
        minValue: typeof c.minValue === 'number' ? c.minValue : 0,
        maxValue: typeof c.maxValue === 'number' ? c.maxValue : 10,
        decimals: typeof c.decimals === 'number' ? c.decimals : 2,
        passThreshold: typeof c.passThreshold === 'number' ? c.passThreshold : 5,
        colorMode: c.colorMode ?? 'NONE',
        headerOrientation: c.headerOrientation ?? 'HORIZONTAL',
        isLocked: Boolean(c.isLocked),
        rubricShowPercentage: Boolean(c.rubricShowPercentage),
        summaryRowOverrides: c.summaryRowOverrides ?? undefined,
        groupSummaryRowOverrides: c.groupSummaryRowOverrides ?? undefined,
        lomloeCriteriaIds: c.lomloeCriteriaIds
          ? toArray<string>(c.lomloeCriteriaIds)
          : undefined,
        averageConfig:
          c.type === 'AVERAGE'
            ? {
                sourceColumnIds: toArray<string>(c.averageConfig?.sourceColumnIds),
                weights: c.averageConfig?.weights ?? {},
                ignoreEmpty: c.averageConfig?.ignoreEmpty ?? true,
              }
            : c.averageConfig,
      })),
    })),
    cells: hydrateCells(book.cells),
  };

  const { book: migrated, removedCount } = migrateRedundantFolderAverageColumns(hydrated);
  return removedCount > 0 ? recalculateBook(migrated, rubrics) : migrated;
}

export function hydrateWorkspace(raw: Partial<GradebookWorkspace>): GradebookWorkspace | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawClasses = toArray<ClassBook>(raw.classes);
  if (rawClasses.length === 0) return null;

  const rubrics = toArray<GradebookWorkspace['rubrics'][number]>(raw.rubrics).map((r) => ({
    ...r,
    levels: toArray<RubricLevel>(r.levels),
    criteria: toArray<RubricCriterion>(r.criteria),
    descriptors: r.descriptors ?? {},
  }));

  const rawKcs = toArray<LomloeKeyCompetenceDef>(raw.lomloeKeyCompetences);
  const lomloeKeyCompetences =
    rawKcs.length > 0
      ? rawKcs
      : DEFAULT_LOMLOE_KEY_COMPETENCES.map((kc) => ({ ...kc }));

  const rawCurricula = toArray<LomloeCurriculum>(raw.lomloeCurricula);
  const lomloeCurricula: LomloeCurriculum[] =
    rawCurricula.length > 0
      ? rawCurricula.map((cur) => ({
          ...cur,
          specificCompetences: toArray<LomloeSpecificCompetence>(cur.specificCompetences).map(
            (ce) => ({
              ...ce,
              keyCompetenceIds: toArray<string>(ce.keyCompetenceIds),
            })
          ),
          criteria: toArray<LomloeCriterion>(cur.criteria).map((cr) => ({
            ...cr,
            keyCompetenceIds: cr.keyCompetenceIds
              ? toArray<string>(cr.keyCompetenceIds)
              : undefined,
          })),
        }))
      : DEFAULT_LOMLOE_RELIGION_CURRICULA.map((cur) => ({
          ...cur,
          specificCompetences: cur.specificCompetences.map((ce) => ({
            ...ce,
            keyCompetenceIds: [...ce.keyCompetenceIds],
          })),
          criteria: cur.criteria.map((cr) => ({ ...cr })),
        }));

  const classes = rawClasses.map((c) => hydrateBook(c, rubrics, false));
  const templates = toArray<ClassBook>(raw.templates).map((t) => hydrateBook(t, rubrics, true));
  return {
    version: raw.version ?? 1,
    classes,
    templates,
    activeMode: raw.activeMode ?? 'CLASS',
    activeClassId: raw.activeClassId ?? classes[0]?.id ?? null,
    activeTemplateId: raw.activeTemplateId ?? templates[0]?.id ?? null,
    activeTabByBook: raw.activeTabByBook ?? {},
    rubrics,
    lomloeKeyCompetences,
    lomloeCurricula,
    settings: {
      rowHeight: raw.settings?.rowHeight ?? 48,
      headerHeight: raw.settings?.headerHeight ?? 84,
      studentColWidth: raw.settings?.studentColWidth ?? 220,
      nameFormat: raw.settings?.nameFormat ?? 'LAST_FIRST',
      showStatsRow: raw.settings?.showStatsRow ?? true,
      sidebarVisible: raw.settings?.sidebarVisible ?? true,
      showRubricsAsPercent: Boolean(raw.settings?.showRubricsAsPercent),
      gridZoom: typeof raw.settings?.gridZoom === 'number' ? raw.settings.gridZoom : 1,
      rubricZoom: typeof raw.settings?.rubricZoom === 'number' ? raw.settings.rubricZoom : 1,
      gradeFontSize:
        typeof raw.settings?.gradeFontSize === 'number' ? raw.settings.gradeFontSize : 15,
      textFontSize:
        typeof raw.settings?.textFontSize === 'number' ? raw.settings.textFontSize : 13.5,
      iconSize: typeof raw.settings?.iconSize === 'number' ? raw.settings.iconSize : 15,
      groupSpacerHeight:
        typeof raw.settings?.groupSpacerHeight === 'number' ? raw.settings.groupSpacerHeight : 24,
      summaryRowHeight:
        typeof raw.settings?.summaryRowHeight === 'number' ? raw.settings.summaryRowHeight : 32,
      defaultColumnWidth:
        typeof raw.settings?.defaultColumnWidth === 'number'
          ? raw.settings.defaultColumnWidth
          : 108,
      defaultFolderWidth:
        typeof raw.settings?.defaultFolderWidth === 'number'
          ? raw.settings.defaultFolderWidth
          : 68,
      showLomloeRow: raw.settings?.showLomloeRow ?? true,
    },
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadLocalWorkspace(): Promise<GradebookWorkspace | null> {
  try {
    const rawStr = localStorage.getItem(LOCAL_KEY);
    if (rawStr) {
      const parsed = hydrateWorkspace(JSON.parse(rawStr));
      if (parsed) return parsed;
    }
  } catch {
    // ignore corrupted localStorage
  }

  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result ? hydrateWorkspace(req.result) : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveLocalWorkspace(ws: GradebookWorkspace): Promise<void> {
  const clean = sanitizeForRtdb(ws);
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(clean));
  } catch {
    // ignore quota errors
  }
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(clean, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearLocalWorkspace(): Promise<void> {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // ignore
  }
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadFirebaseWorkspace(uid: string): Promise<GradebookWorkspace | null> {
  if (!firebaseDb || !isFirebaseConfigured) return null;
  const snap = await get(ref(firebaseDb, rtdbWorkspacePath(uid)));
  if (!snap.exists()) return null;
  return hydrateWorkspace(snap.val());
}

export async function saveFirebaseWorkspace(uid: string, ws: GradebookWorkspace): Promise<void> {
  if (!firebaseDb || !isFirebaseConfigured) return;
  await set(ref(firebaseDb, rtdbWorkspacePath(uid)), sanitizeForRtdb(ws));
}

export function subscribeFirebaseWorkspace(
  uid: string,
  onData: (ws: GradebookWorkspace) => void,
  onErr: (err: Error) => void
): Unsubscribe {
  if (!firebaseDb || !isFirebaseConfigured) return () => {};
  return onValue(
    ref(firebaseDb, rtdbWorkspacePath(uid)),
    (snap) => {
      if (snap.exists()) {
        const parsed = hydrateWorkspace(snap.val());
        if (parsed) onData(parsed);
      }
    },
    (error) => onErr(error)
  );
}
