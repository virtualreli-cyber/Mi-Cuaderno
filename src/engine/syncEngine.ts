import { recalculateBook } from './gradeMath';
import type {
  CellEntity,
  ClassBook,
  ColumnEntity,
  FolderEntity,
  GradebookWorkspace,
  LomloeCurriculum,
  RubricEntity,
  StudentEntity,
  TabEntity,
  ViewSettings,
} from '../types/gradebook';

export interface SyncCellConflict {
  id: string;
  bookId: string;
  bookName: string;
  studentId: string;
  studentName: string;
  columnId: string;
  columnTitle: string;
  localCell: CellEntity | null;
  remoteCell: CellEntity | null;
  chosen: 'LOCAL' | 'REMOTE';
}

export interface ThreeWayMergeResult {
  workspace: GradebookWorkspace;
  hadDivergence: boolean;
  localEditsMerged: number;
  remoteEditsMerged: number;
  cellConflicts: SyncCellConflict[];
}

function stableJson(val: unknown): string {
  if (val === undefined || val === null) return 'null';
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(stableJson).join(',')}]`;
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function normalizeCell(cell: CellEntity | undefined): CellEntity | null {
  if (!cell) return null;
  const hasGrade = cell.grade !== null && cell.grade !== undefined && !Number.isNaN(cell.grade);
  const cleanComment = (cell.comment ?? '').trim();
  const hasRubric = Boolean(cell.rubricEval && Object.keys(cell.rubricEval.selections ?? {}).length > 0);
  if (!hasGrade && !cleanComment && !hasRubric) return null;
  return {
    grade: hasGrade ? cell.grade : null,
    comment: cleanComment,
    ...(cell.rubricEval ? { rubricEval: cell.rubricEval } : {}),
    ...(cell.manualOverride ? { manualOverride: true } : {}),
  };
}

function preferLocalByTimestamp(localUpdatedAt: string, remoteUpdatedAt: string): boolean {
  const l = Date.parse(localUpdatedAt);
  const r = Date.parse(remoteUpdatedAt);
  if (Number.isFinite(l) && Number.isFinite(r)) {
    return l >= r;
  }
  return true;
}

/**
 * Generic 3-way merge for arrays of ID-keyed entities (students, folders, columns, rubrics, curricula).
 * Preserves independent additions, updates, and deletions from both offline local and online remote devices.
 */
function mergeById<T extends { id: string }>(
  baseList: T[] | undefined,
  localList: T[],
  remoteList: T[],
  preferLocal: boolean,
  customMergeBoth?: (baseItem: T | undefined, localItem: T, remoteItem: T) => T
): { items: T[]; localChanges: number; remoteChanges: number } {
  const baseMap = new Map((baseList ?? []).map((item) => [item.id, item]));
  const localMap = new Map(localList.map((item) => [item.id, item]));
  const remoteMap = new Map(remoteList.map((item) => [item.id, item]));

  // Preserve visual order: start with preferred side's order, then append unique additions from other side
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const primary = preferLocal ? localList : remoteList;
  const secondary = preferLocal ? remoteList : localList;
  for (const item of primary) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      orderedIds.push(item.id);
    }
  }
  for (const item of secondary) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      orderedIds.push(item.id);
    }
  }

  const items: T[] = [];
  let localChanges = 0;
  let remoteChanges = 0;

  for (const id of orderedIds) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);

    if (l && r) {
      if (sameValue(l, r)) {
        items.push(l);
      } else if (b && sameValue(l, b)) {
        items.push(r);
        remoteChanges += 1;
      } else if (b && sameValue(r, b)) {
        items.push(l);
        localChanges += 1;
      } else {
        // Both modified
        if (customMergeBoth) {
          items.push(customMergeBoth(b, l, r));
        } else {
          items.push(preferLocal ? l : r);
        }
        localChanges += 1;
        remoteChanges += 1;
      }
    } else if (l && !r) {
      if (!b) {
        // Added locally offline
        items.push(l);
        localChanges += 1;
      } else if (!sameValue(l, b)) {
        // Deleted remotely, but modified locally -> keep local to avoid losing offline work
        items.push(l);
        localChanges += 1;
      } else {
        // Unchanged locally, explicitly deleted remotely -> honor remote delete
        remoteChanges += 1;
      }
    } else if (!l && r) {
      if (!b) {
        // Added remotely
        items.push(r);
        remoteChanges += 1;
      } else if (!sameValue(r, b)) {
        // Deleted locally, but modified remotely -> keep remote
        items.push(r);
        remoteChanges += 1;
      } else {
        // Explicitly deleted locally offline -> honor local delete
        localChanges += 1;
      }
    }
  }

  return { items, localChanges, remoteChanges };
}

function mergeTab(
  baseTab: TabEntity | undefined,
  localTab: TabEntity,
  remoteTab: TabEntity,
  preferLocal: boolean
): { tab: TabEntity; localChanges: number; remoteChanges: number } {
  const folderMerge = mergeById<FolderEntity>(
    baseTab?.folders,
    localTab.folders,
    remoteTab.folders,
    preferLocal
  );
  const colMerge = mergeById<ColumnEntity>(
    baseTab?.columns,
    localTab.columns,
    remoteTab.columns,
    preferLocal,
    (baseCol, localCol, remoteCol) => {
      const chosen = preferLocal ? localCol : remoteCol;
      const baseCriteria = baseCol?.lomloeCriteriaIds ?? [];
      const localCriteria = localCol.lomloeCriteriaIds ?? [];
      const remoteCriteria = remoteCol.lomloeCriteriaIds ?? [];
      let mergedCriteria = chosen.lomloeCriteriaIds;
      if (baseCol) {
        const localChangedCrit = !sameValue(localCriteria, baseCriteria);
        const remoteChangedCrit = !sameValue(remoteCriteria, baseCriteria);
        if (localChangedCrit && !remoteChangedCrit) {
          mergedCriteria = localCol.lomloeCriteriaIds;
        } else if (!localChangedCrit && remoteChangedCrit) {
          mergedCriteria = remoteCol.lomloeCriteriaIds;
        }
      } else if (
        (!mergedCriteria || mergedCriteria.length === 0) &&
        (localCriteria.length > 0 || remoteCriteria.length > 0)
      ) {
        mergedCriteria =
          localCriteria.length > 0 ? localCol.lomloeCriteriaIds : remoteCol.lomloeCriteriaIds;
      }
      if (mergedCriteria !== undefined) {
        return { ...chosen, lomloeCriteriaIds: mergedCriteria };
      }
      const next = { ...chosen };
      delete next.lomloeCriteriaIds;
      return next;
    }
  );

  // Merge itemOrder preserving all surviving top-level folder & standalone column IDs
  const validTopIds = new Set<string>([
    ...folderMerge.items.map((f) => f.id),
    ...colMerge.items.filter((c) => !c.folderId).map((c) => c.id),
  ]);
  const primaryOrder = (preferLocal ? localTab.itemOrder : remoteTab.itemOrder) ?? [];
  const secondaryOrder = (preferLocal ? remoteTab.itemOrder : localTab.itemOrder) ?? [];
  const mergedOrder: string[] = [];
  const seenOrder = new Set<string>();
  for (const id of [...primaryOrder, ...secondaryOrder, ...validTopIds]) {
    if (validTopIds.has(id) && !seenOrder.has(id)) {
      seenOrder.add(id);
      mergedOrder.push(id);
    }
  }

  const baseMeta = baseTab
    ? { title: baseTab.title, color: baseTab.color, orderIndex: baseTab.orderIndex, isLocked: baseTab.isLocked }
    : null;
  const localMeta = {
    title: localTab.title,
    color: localTab.color,
    orderIndex: localTab.orderIndex,
    isLocked: localTab.isLocked,
  };
  const remoteMeta = {
    title: remoteTab.title,
    color: remoteTab.color,
    orderIndex: remoteTab.orderIndex,
    isLocked: remoteTab.isLocked,
  };

  const chosenMeta =
    baseMeta && sameValue(localMeta, baseMeta)
      ? remoteMeta
      : baseMeta && sameValue(remoteMeta, baseMeta)
        ? localMeta
        : preferLocal
          ? localMeta
          : remoteMeta;

  return {
    tab: {
      ...remoteTab,
      ...chosenMeta,
      folders: folderMerge.items,
      columns: colMerge.items,
      itemOrder: mergedOrder,
    },
    localChanges: folderMerge.localChanges + colMerge.localChanges,
    remoteChanges: folderMerge.remoteChanges + colMerge.remoteChanges,
  };
}

function mergeBook(
  baseBook: ClassBook | undefined,
  localBook: ClassBook,
  remoteBook: ClassBook,
  preferLocal: boolean,
  rubrics: RubricEntity[]
): {
  book: ClassBook;
  localChanges: number;
  remoteChanges: number;
  cellConflicts: SyncCellConflict[];
} {
  let localChanges = 0;
  let remoteChanges = 0;
  const cellConflicts: SyncCellConflict[] = [];

  const studentMerge = mergeById<StudentEntity>(
    baseBook?.students,
    localBook.students,
    remoteBook.students,
    preferLocal
  );
  localChanges += studentMerge.localChanges;
  remoteChanges += studentMerge.remoteChanges;

  const tabMerge = mergeById<TabEntity>(
    baseBook?.tabs,
    localBook.tabs,
    remoteBook.tabs,
    preferLocal,
    (bTab, lTab, rTab) => {
      const m = mergeTab(bTab, lTab, rTab, preferLocal);
      localChanges += m.localChanges;
      remoteChanges += m.remoteChanges;
      return m.tab;
    }
  );
  localChanges += tabMerge.localChanges;
  remoteChanges += tabMerge.remoteChanges;

  // Build lookups for readable conflict descriptions
  const studentNameById = new Map(
    studentMerge.items.map((s) => [s.id, `${s.lastName}, ${s.firstName}`.trim()])
  );
  const colTitleById = new Map<string, string>();
  const validColIds = new Set<string>();
  const calculatedColIds = new Set<string>();
  for (const tab of tabMerge.items) {
    for (const col of tab.columns) {
      validColIds.add(col.id);
      colTitleById.set(col.id, col.title);
      if (col.type === 'AVERAGE') calculatedColIds.add(col.id);
    }
  }
  const validStudentIds = new Set(studentMerge.items.map((s) => s.id));

  // Per-cell 3-way merge
  const mergedCells: Record<string, CellEntity> = {};
  const allCellKeys = new Set<string>([
    ...Object.keys(baseBook?.cells ?? {}),
    ...Object.keys(localBook.cells ?? {}),
    ...Object.keys(remoteBook.cells ?? {}),
  ]);

  for (const key of allCellKeys) {
    const sep = key.indexOf('::');
    if (sep <= 0) continue;
    const studentId = key.slice(0, sep);
    const columnId = key.slice(sep + 2);
    if (!validStudentIds.has(studentId) || !validColIds.has(columnId)) continue;

    // Calculated average columns will be recomputed by recalculateBook; don't flag false conflicts on them
    if (calculatedColIds.has(columnId)) continue;

    const bCell = normalizeCell(baseBook?.cells?.[key]);
    const lCell = normalizeCell(localBook.cells?.[key]);
    const rCell = normalizeCell(remoteBook.cells?.[key]);

    if (sameValue(lCell, rCell)) {
      if (lCell) mergedCells[key] = lCell;
      continue;
    }

    if (baseBook && sameValue(lCell, bCell)) {
      // Only remote changed (or deleted)
      if (rCell) mergedCells[key] = rCell;
      remoteChanges += 1;
      continue;
    }

    if (baseBook && sameValue(rCell, bCell)) {
      // Only local changed (or deleted) offline
      if (lCell) mergedCells[key] = lCell;
      localChanges += 1;
      continue;
    }

    // Without a base snapshot: if one side is empty and the other has data, keep the populated cell
    if (!baseBook) {
      if (lCell && !rCell) {
        mergedCells[key] = lCell;
        localChanges += 1;
        continue;
      }
      if (rCell && !lCell) {
        mergedCells[key] = rCell;
        remoteChanges += 1;
        continue;
      }
    }

    // True concurrent conflict on the exact same student + column
    const chosen: 'LOCAL' | 'REMOTE' = preferLocal ? 'LOCAL' : 'REMOTE';
    const winner = chosen === 'LOCAL' ? lCell : rCell;
    if (winner) mergedCells[key] = winner;
    localChanges += 1;
    remoteChanges += 1;

    cellConflicts.push({
      id: `${localBook.id}::${key}`,
      bookId: localBook.id,
      bookName: localBook.name || remoteBook.name,
      studentId,
      studentName: studentNameById.get(studentId) ?? studentId,
      columnId,
      columnTitle: colTitleById.get(columnId) ?? columnId,
      localCell: lCell,
      remoteCell: rCell,
      chosen,
    });
  }

  // Merge book-level scalar & group metadata
  const pickBookField = <K extends keyof ClassBook>(field: K): ClassBook[K] => {
    const bVal = baseBook?.[field];
    const lVal = localBook[field];
    const rVal = remoteBook[field];
    if (sameValue(lVal, rVal)) return lVal;
    if (baseBook && sameValue(lVal, bVal)) return rVal;
    if (baseBook && sameValue(rVal, bVal)) return lVal;
    return preferLocal ? lVal : rVal;
  };

  const mergedBookRaw: ClassBook = {
    ...remoteBook,
    id: localBook.id,
    name: pickBookField('name'),
    subject: pickBookField('subject'),
    school: pickBookField('school'),
    year: pickBookField('year'),
    color: pickBookField('color'),
    passThreshold: pickBookField('passThreshold'),
    sortMode: pickBookField('sortMode'),
    groupByGroups: pickBookField('groupByGroups'),
    groups: pickBookField('groups'),
    groupCategories: pickBookField('groupCategories'),
    activeGroupCategoryId: pickBookField('activeGroupCategoryId'),
    groupSpacerRows: pickBookField('groupSpacerRows'),
    // Keep device-local collapsedGroups preference
    collapsedGroups: localBook.collapsedGroups,
    summaryRows: pickBookField('summaryRows'),
    groupSummaryRows: pickBookField('groupSummaryRows'),
    lomloeCurriculumId: pickBookField('lomloeCurriculumId'),
    showLomloeRow: pickBookField('showLomloeRow'),
    isTemplate: localBook.isTemplate ?? remoteBook.isTemplate,
    students: studentMerge.items,
    tabs: tabMerge.items,
    cells: mergedCells,
  };

  return {
    book: recalculateBook(mergedBookRaw, rubrics),
    localChanges,
    remoteChanges,
    cellConflicts,
  };
}

/**
 * Preserves device-local UI/view settings (sidebar, collapsed schools, grid zoom) while merging
 * shared preferences cleanly so an iPad never clobbers a desktop's layout and vice versa.
 */
function mergeSettings(
  base: ViewSettings | undefined,
  local: ViewSettings,
  remote: ViewSettings,
  preferLocal: boolean
): ViewSettings {
  const pick = <K extends keyof ViewSettings>(key: K): ViewSettings[K] => {
    if (sameValue(local[key], remote[key])) return local[key];
    if (base && sameValue(local[key], base[key])) return remote[key];
    if (base && sameValue(remote[key], base[key])) return local[key];
    return preferLocal ? local[key] : remote[key];
  };

  return {
    ...remote,
    rowHeight: pick('rowHeight'),
    headerHeight: pick('headerHeight'),
    studentColWidth: pick('studentColWidth'),
    nameFormat: pick('nameFormat'),
    showStatsRow: pick('showStatsRow'),
    showRubricsAsPercent: pick('showRubricsAsPercent'),
    gradeFontSize: pick('gradeFontSize'),
    textFontSize: pick('textFontSize'),
    iconSize: pick('iconSize'),
    groupSpacerHeight: pick('groupSpacerHeight'),
    summaryRowHeight: pick('summaryRowHeight'),
    defaultColumnWidth: pick('defaultColumnWidth'),
    defaultFolderWidth: pick('defaultFolderWidth'),
    showLomloeRow: pick('showLomloeRow'),
    // Always keep device-local layout/zoom state untouched by remote devices
    sidebarVisible: local.sidebarVisible,
    collapsedSchools: local.collapsedSchools ?? {},
    gridZoom: local.gridZoom ?? 1,
    rubricZoom: local.rubricZoom ?? 1,
  };
}

/**
 * Performs a deterministic 3-way semantic merge between a common synced ancestor (`base`),
 * offline local edits (`local`), and concurrent cloud edits (`remote`).
 *
 * Guarantees:
 * - Never loses offline grades entered in different books, students, or columns.
 * - Honors explicit deletions when the other device didn't modify the same item.
 * - Preserves device-local UI prefs (zoom, sidebar, collapsed folders/schools).
 * - Reports any true concurrent same-cell conflict so the user can review and swap in 1 tap.
 */
export function mergeWorkspaces3Way(
  base: GradebookWorkspace | null,
  local: GradebookWorkspace,
  remote: GradebookWorkspace
): ThreeWayMergeResult {
  const preferLocal = preferLocalByTimestamp(local.updatedAt, remote.updatedAt);

  const rubricsMerge = mergeById<RubricEntity>(
    base?.rubrics,
    local.rubrics,
    remote.rubrics,
    preferLocal
  );
  const curriculaMerge = mergeById<LomloeCurriculum>(
    base?.lomloeCurricula,
    local.lomloeCurricula ?? [],
    remote.lomloeCurricula ?? [],
    preferLocal
  );

  let localEditsMerged = rubricsMerge.localChanges + curriculaMerge.localChanges;
  let remoteEditsMerged = rubricsMerge.remoteChanges + curriculaMerge.remoteChanges;
  const allConflicts: SyncCellConflict[] = [];

  const classesMerge = mergeById<ClassBook>(
    base?.classes,
    local.classes,
    remote.classes,
    preferLocal,
    (bBook, lBook, rBook) => {
      const m = mergeBook(bBook, lBook, rBook, preferLocal, rubricsMerge.items);
      localEditsMerged += m.localChanges;
      remoteEditsMerged += m.remoteChanges;
      allConflicts.push(...m.cellConflicts);
      return m.book;
    }
  );
  localEditsMerged += classesMerge.localChanges;
  remoteEditsMerged += classesMerge.remoteChanges;

  const templatesMerge = mergeById<ClassBook>(
    base?.templates,
    local.templates,
    remote.templates,
    preferLocal,
    (bBook, lBook, rBook) => {
      const m = mergeBook(bBook, lBook, rBook, preferLocal, rubricsMerge.items);
      localEditsMerged += m.localChanges;
      remoteEditsMerged += m.remoteChanges;
      allConflicts.push(...m.cellConflicts);
      return m.book;
    }
  );
  localEditsMerged += templatesMerge.localChanges;
  remoteEditsMerged += templatesMerge.remoteChanges;

  const mergedClasses = classesMerge.items.map((c) => recalculateBook(c, rubricsMerge.items));
  const mergedTemplates = templatesMerge.items.map((t) => recalculateBook(t, rubricsMerge.items));

  const validClassIds = new Set(mergedClasses.map((c) => c.id));
  const validTemplateIds = new Set(mergedTemplates.map((t) => t.id));

  const activeClassId =
    local.activeClassId && validClassIds.has(local.activeClassId)
      ? local.activeClassId
      : remote.activeClassId && validClassIds.has(remote.activeClassId)
        ? remote.activeClassId
        : (mergedClasses[0]?.id ?? null);

  const activeTemplateId =
    local.activeTemplateId && validTemplateIds.has(local.activeTemplateId)
      ? local.activeTemplateId
      : remote.activeTemplateId && validTemplateIds.has(remote.activeTemplateId)
        ? remote.activeTemplateId
        : (mergedTemplates[0]?.id ?? null);

  const mergedWorkspace: GradebookWorkspace = {
    version: Math.max(local.version, remote.version),
    classes: mergedClasses,
    templates: mergedTemplates,
    activeMode: local.activeMode,
    activeClassId,
    activeTemplateId,
    activeTabByBook: {
      ...(remote.activeTabByBook ?? {}),
      ...(local.activeTabByBook ?? {}),
    },
    rubrics: rubricsMerge.items,
    lomloeKeyCompetences: preferLocal
      ? (local.lomloeKeyCompetences ?? remote.lomloeKeyCompetences)
      : (remote.lomloeKeyCompetences ?? local.lomloeKeyCompetences),
    lomloeCurricula:
      curriculaMerge.items.length > 0
        ? curriculaMerge.items
        : (remote.lomloeCurricula ?? local.lomloeCurricula),
    settings: mergeSettings(base?.settings, local.settings, remote.settings, preferLocal),
    updatedAt: new Date().toISOString(),
  };

  return {
    workspace: mergedWorkspace,
    hadDivergence: localEditsMerged > 0 && remoteEditsMerged > 0,
    localEditsMerged,
    remoteEditsMerged,
    cellConflicts: allConflicts,
  };
}
