import { ensureGroupCategories, recalculateBook } from './gradeMath';
import type {
  CellEntity,
  ClassBook,
  ColumnEntity,
  FolderEntity,
  GradebookWorkspace,
  GroupCategoryDef,
  LomloeCurriculum,
  RubricEntity,
  StudentEntity,
  StudentGroupDef,
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
  const hasNotice = Boolean(cell.autoRecalcNotice);
  const hasPending =
    typeof cell.pendingAdjustment === 'number' &&
    Number.isFinite(cell.pendingAdjustment) &&
    cell.pendingAdjustment !== 0;
  const hasAppliedAdj =
    typeof cell.appliedAdjustment === 'number' &&
    Number.isFinite(cell.appliedAdjustment) &&
    cell.appliedAdjustment !== 0;
  const hasPreAdjGrade =
    hasAppliedAdj &&
    typeof cell.preAdjustmentGrade === 'number' &&
    Number.isFinite(cell.preAdjustmentGrade);
  if (!hasGrade && !cleanComment && !hasRubric && !hasNotice && !hasPending) return null;
  return {
    grade: hasGrade ? cell.grade : null,
    comment: cleanComment,
    ...(cell.rubricEval ? { rubricEval: cell.rubricEval } : {}),
    ...(cell.manualOverride ? { manualOverride: true } : {}),
    ...(typeof cell.manualSourceSignature === 'string' && cell.manualOverride
      ? { manualSourceSignature: cell.manualSourceSignature }
      : {}),
    ...(hasNotice ? { autoRecalcNotice: true } : {}),
    ...(hasPending ? { pendingAdjustment: cell.pendingAdjustment } : {}),
    ...(hasAppliedAdj ? { appliedAdjustment: cell.appliedAdjustment } : {}),
    ...(hasPreAdjGrade ? { preAdjustmentGrade: cell.preAdjustmentGrade } : {}),
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

function stripFolderUi(folder: FolderEntity): Omit<FolderEntity, 'width' | 'isCollapsed'> {
  const { width: _w, isCollapsed: _c, ...rest } = folder;
  return rest;
}

function stripColumnUi(col: ColumnEntity): Omit<ColumnEntity, 'width' | 'rubricExpanded'> {
  const { width: _w, rubricExpanded: _rExp, ...rest } = col;
  return rest;
}

function dedupeStudentGroups(groups: StudentGroupDef[]): StudentGroupDef[] {
  const deduped: StudentGroupDef[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    const low = g.name.trim().toLowerCase();
    if (!low || seen.has(low)) continue;
    seen.add(low);
    deduped.push({ ...g, orderIndex: deduped.length });
  }
  return deduped;
}

function mergeGroupDefs(
  baseGroups: StudentGroupDef[] | undefined,
  localGroups: StudentGroupDef[],
  remoteGroups: StudentGroupDef[],
  preferLocal: boolean
): { groups: StudentGroupDef[]; localChanges: number; remoteChanges: number } {
  const merged = mergeById<StudentGroupDef>(
    baseGroups,
    localGroups,
    remoteGroups,
    preferLocal
  );
  return {
    groups: dedupeStudentGroups(merged.items),
    localChanges: merged.localChanges,
    remoteChanges: merged.remoteChanges,
  };
}

function mergeStringRecord3Way(
  baseMap: Record<string, string> | undefined,
  localMap: Record<string, string> | undefined,
  remoteMap: Record<string, string> | undefined,
  validKeys: Set<string>,
  preferLocal: boolean
): { map: Record<string, string>; localChanges: number; remoteChanges: number } {
  const out: Record<string, string> = {};
  let localChanges = 0;
  let remoteChanges = 0;
  const allKeys = new Set<string>([
    ...Object.keys(baseMap ?? {}),
    ...Object.keys(localMap ?? {}),
    ...Object.keys(remoteMap ?? {}),
  ]);
  const hasBase = baseMap !== undefined;

  for (const k of allKeys) {
    if (!validKeys.has(k)) continue;
    const bVal = baseMap?.[k]?.trim() || undefined;
    const lVal = localMap?.[k]?.trim() || undefined;
    const rVal = remoteMap?.[k]?.trim() || undefined;

    if (lVal === rVal) {
      if (lVal) out[k] = lVal;
      continue;
    }
    if (hasBase && lVal === bVal) {
      if (rVal) out[k] = rVal;
      remoteChanges += 1;
      continue;
    }
    if (hasBase && rVal === bVal) {
      if (lVal) out[k] = lVal;
      localChanges += 1;
      continue;
    }
    if (!hasBase) {
      if (lVal && !rVal) {
        out[k] = lVal;
        localChanges += 1;
        continue;
      }
      if (rVal && !lVal) {
        out[k] = rVal;
        remoteChanges += 1;
        continue;
      }
    }
    const chosen = preferLocal ? lVal : rVal;
    if (chosen) out[k] = chosen;
    localChanges += 1;
    remoteChanges += 1;
  }

  return { map: out, localChanges, remoteChanges };
}

function mergeGroupCategory(
  baseCat: GroupCategoryDef | undefined,
  localCat: GroupCategoryDef,
  remoteCat: GroupCategoryDef,
  validStudentIds: Set<string>,
  preferLocal: boolean
): { category: GroupCategoryDef; localChanges: number; remoteChanges: number } {
  let localChanges = 0;
  let remoteChanges = 0;

  let mergedName = preferLocal ? localCat.name : remoteCat.name;
  if (localCat.name === remoteCat.name) {
    mergedName = localCat.name;
  } else if (baseCat && localCat.name === baseCat.name) {
    mergedName = remoteCat.name;
    remoteChanges += 1;
  } else if (baseCat && remoteCat.name === baseCat.name) {
    mergedName = localCat.name;
    localChanges += 1;
  } else {
    localChanges += 1;
    remoteChanges += 1;
  }

  const groupMerge = mergeGroupDefs(
    baseCat?.groups,
    localCat.groups ?? [],
    remoteCat.groups ?? [],
    preferLocal
  );
  localChanges += groupMerge.localChanges;
  remoteChanges += groupMerge.remoteChanges;

  const assignMerge = mergeStringRecord3Way(
    baseCat?.assignments,
    localCat.assignments,
    remoteCat.assignments,
    validStudentIds,
    preferLocal
  );
  localChanges += assignMerge.localChanges;
  remoteChanges += assignMerge.remoteChanges;

  const baseOrder = baseCat?.studentOrder;
  const localOrder = localCat.studentOrder;
  const remoteOrder = remoteCat.studentOrder;
  let mergedStudentOrder: Record<string, string[]> | undefined;
  if (localOrder || remoteOrder) {
    const orderKeys = new Set([
      ...Object.keys(baseOrder ?? {}),
      ...Object.keys(localOrder ?? {}),
      ...Object.keys(remoteOrder ?? {}),
    ]);
    const nextOrder: Record<string, string[]> = {};
    for (const grpKey of orderKeys) {
      const bArr = baseOrder?.[grpKey];
      const lArr = localOrder?.[grpKey];
      const rArr = remoteOrder?.[grpKey];
      let chosenArr: string[] | undefined;
      if (sameValue(lArr, rArr)) chosenArr = lArr;
      else if (baseCat && sameValue(lArr, bArr)) chosenArr = rArr;
      else if (baseCat && sameValue(rArr, bArr)) chosenArr = lArr;
      else if (!baseCat && lArr && !rArr) chosenArr = lArr;
      else if (!baseCat && rArr && !lArr) chosenArr = rArr;
      else chosenArr = preferLocal ? lArr : rArr;
      if (chosenArr && chosenArr.length > 0) {
        const filtered = chosenArr.filter((sid) => validStudentIds.has(sid));
        if (filtered.length > 0) nextOrder[grpKey] = filtered;
      }
    }
    if (Object.keys(nextOrder).length > 0) {
      mergedStudentOrder = nextOrder;
    }
  }

  return {
    category: {
      id: localCat.id,
      name: mergedName,
      groups: groupMerge.groups,
      assignments: assignMerge.map,
      ...(mergedStudentOrder ? { studentOrder: mergedStudentOrder } : {}),
    },
    localChanges,
    remoteChanges,
  };
}

function mergeTab(
  baseTab: TabEntity | undefined,
  localTab: TabEntity,
  remoteTab: TabEntity,
  preferLocal: boolean
): { tab: TabEntity; localChanges: number; remoteChanges: number } {
  const localFolderMap = new Map(localTab.folders.map((f) => [f.id, f]));
  const baseFoldersData = baseTab?.folders.map((f) => stripFolderUi(f) as FolderEntity);
  const localFoldersData = localTab.folders.map((f) => stripFolderUi(f) as FolderEntity);
  const remoteFoldersData = remoteTab.folders.map((f) => stripFolderUi(f) as FolderEntity);

  const folderMerge = mergeById<FolderEntity>(
    baseFoldersData,
    localFoldersData,
    remoteFoldersData,
    preferLocal
  );
  const restoredFolders = folderMerge.items.map((f) => {
    const localF = localFolderMap.get(f.id);
    if (!localF) return f;
    return {
      ...f,
      width: localF.width,
      isCollapsed: localF.isCollapsed,
    };
  });

  const localColMap = new Map(localTab.columns.map((c) => [c.id, c]));
  const baseColsData = baseTab?.columns.map((c) => stripColumnUi(c) as ColumnEntity);
  const localColsData = localTab.columns.map((c) => stripColumnUi(c) as ColumnEntity);
  const remoteColsData = remoteTab.columns.map((c) => stripColumnUi(c) as ColumnEntity);

  const colMerge = mergeById<ColumnEntity>(
    baseColsData,
    localColsData,
    remoteColsData,
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
  const restoredCols = colMerge.items.map((c) => {
    const localC = localColMap.get(c.id);
    if (!localC) return c;
    return {
      ...c,
      width: localC.width,
    };
  });

  // Merge itemOrder preserving all surviving top-level folder & standalone column IDs
  const validTopIds = new Set<string>([
    ...restoredFolders.map((f) => f.id),
    ...restoredCols.filter((c) => !c.folderId).map((c) => c.id),
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
      folders: restoredFolders,
      columns: restoredCols,
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
  const pickBookField = <K extends keyof ClassBook>(
    field: K,
    normalize: (val: ClassBook[K]) => unknown = (v) => v
  ): ClassBook[K] => {
    const bVal = baseBook ? baseBook[field] : undefined;
    const lVal = localBook[field];
    const rVal = remoteBook[field];
    const nb = baseBook ? normalize(bVal as ClassBook[K]) : undefined;
    const nl = normalize(lVal);
    const nr = normalize(rVal);
    if (sameValue(nl, nr)) return lVal;
    if (baseBook && sameValue(nl, nb)) {
      remoteChanges += 1;
      return rVal;
    }
    if (baseBook && sameValue(nr, nb)) {
      localChanges += 1;
      return lVal;
    }
    localChanges += 1;
    remoteChanges += 1;
    return preferLocal ? lVal : rVal;
  };

  // Semantic 3-way merge of class grouping configuration (categories, groups, student assignments)
  const hasAnyCategories =
    Boolean(baseBook?.groupCategories && baseBook.groupCategories.length > 0) ||
    Boolean(localBook.groupCategories && localBook.groupCategories.length > 0) ||
    Boolean(remoteBook.groupCategories && remoteBook.groupCategories.length > 0);

  let mergedGroups: StudentGroupDef[] | undefined;
  let mergedGroupCategories: GroupCategoryDef[] | undefined;
  let mergedActiveGroupCategoryId: string | null | undefined;
  let alignedStudents = studentMerge.items;

  if (hasAnyCategories) {
    const bCats = baseBook ? ensureGroupCategories(baseBook).categories : undefined;
    const lCats = ensureGroupCategories(localBook).categories;
    const rCats = ensureGroupCategories(remoteBook).categories;
    const catMerge = mergeById<GroupCategoryDef>(
      bCats,
      lCats,
      rCats,
      preferLocal,
      (bCat, lCat, rCat) => {
        const m = mergeGroupCategory(bCat, lCat, rCat, validStudentIds, preferLocal);
        localChanges += m.localChanges;
        remoteChanges += m.remoteChanges;
        return m.category;
      }
    );
    localChanges += catMerge.localChanges;
    remoteChanges += catMerge.remoteChanges;

    // Ensure every surviving category has student assignments pruned cleanly to surviving students
    mergedGroupCategories = catMerge.items.map((cat) => {
      const prunedAssignments: Record<string, string> = {};
      for (const [sid, grpName] of Object.entries(cat.assignments ?? {})) {
        if (validStudentIds.has(sid) && grpName?.trim()) {
          prunedAssignments[sid] = grpName.trim();
        }
      }
      return {
        ...cat,
        groups: dedupeStudentGroups(cat.groups ?? []),
        assignments: prunedAssignments,
      };
    });

    const resolveExplicitActiveCatId = (book: ClassBook | undefined): string | null =>
      book?.groupCategories && book.groupCategories.length > 0
        ? (book.activeGroupCategoryId ?? book.groupCategories[0].id)
        : null;
    const bActiveCat = resolveExplicitActiveCatId(baseBook);
    const lActiveCat = resolveExplicitActiveCatId(localBook);
    const rActiveCat = resolveExplicitActiveCatId(remoteBook);

    let chosenActiveCat: string | null;
    if (lActiveCat === rActiveCat) {
      chosenActiveCat = lActiveCat;
    } else if (baseBook && lActiveCat === bActiveCat) {
      chosenActiveCat = rActiveCat;
      if (rActiveCat !== null) remoteChanges += 1;
    } else if (baseBook && rActiveCat === bActiveCat) {
      chosenActiveCat = lActiveCat;
      if (lActiveCat !== null) localChanges += 1;
    } else if (!baseBook && lActiveCat && !rActiveCat) {
      chosenActiveCat = lActiveCat;
      localChanges += 1;
    } else if (!baseBook && rActiveCat && !lActiveCat) {
      chosenActiveCat = rActiveCat;
      remoteChanges += 1;
    } else {
      chosenActiveCat = preferLocal ? lActiveCat : rActiveCat;
      localChanges += 1;
      remoteChanges += 1;
    }

    mergedActiveGroupCategoryId =
      chosenActiveCat && mergedGroupCategories.some((c) => c.id === chosenActiveCat)
        ? chosenActiveCat
        : (mergedGroupCategories[0]?.id ?? undefined);

    const defaultCat = mergedGroupCategories[0];
    mergedGroups = defaultCat?.groups;
    if (defaultCat) {
      alignedStudents = studentMerge.items.map((st) => ({
        ...st,
        group: defaultCat.assignments[st.id] || undefined,
      }));
    }
  } else {
    const legacyGroupMerge = mergeGroupDefs(
      baseBook?.groups,
      localBook.groups ?? [],
      remoteBook.groups ?? [],
      preferLocal
    );
    localChanges += legacyGroupMerge.localChanges;
    remoteChanges += legacyGroupMerge.remoteChanges;
    mergedGroups =
      legacyGroupMerge.groups.length > 0
        ? legacyGroupMerge.groups
        : localBook.groups !== undefined || remoteBook.groups !== undefined
          ? []
          : undefined;
    mergedActiveGroupCategoryId = pickBookField('activeGroupCategoryId', (v) => v ?? null);
  }

  const mergedBookRaw: ClassBook = {
    ...remoteBook,
    id: localBook.id,
    name: pickBookField('name'),
    subject: pickBookField('subject'),
    school: pickBookField('school', (v) => v ?? null),
    year: pickBookField('year'),
    color: pickBookField('color'),
    passThreshold: pickBookField('passThreshold'),
    sortMode: pickBookField('sortMode'),
    groupByGroups: Boolean(pickBookField('groupByGroups', (v) => Boolean(v))),
    groups: mergedGroups,
    groupCategories: mergedGroupCategories,
    activeGroupCategoryId: mergedActiveGroupCategoryId,
    // Keep all device-local aspect & view state untouched by remote devices
    groupSpacerRows: localBook.groupSpacerRows,
    collapsedGroups: localBook.collapsedGroups,
    summaryRows: pickBookField('summaryRows', (v) => v ?? []),
    groupSummaryRows: pickBookField('groupSummaryRows', (v) => v ?? []),
    lomloeCurriculumId: pickBookField('lomloeCurriculumId', (v) => v ?? null),
    showLomloeRow: localBook.showLomloeRow,
    tutor: pickBookField('tutor', (v) => (v ?? '').trim()),
    notes: pickBookField('notes', (v) => (v ?? '').trim()),
    isTemplate: localBook.isTemplate ?? remoteBook.isTemplate,
    students: alignedStudents,
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
 * Keeps ALL device-local aspect/UI settings (zoom, row/header height, font sizes, sidebar,
 * collapsed schools) completely independent across devices. Sync transfers data only.
 */
function mergeSettings(
  _base: ViewSettings | undefined,
  local: ViewSettings,
  _remote: ViewSettings,
  _preferLocal: boolean
): ViewSettings {
  return {
    ...local,
    collapsedSchools: local.collapsedSchools ?? {},
    gridZoom: local.gridZoom ?? 1,
    rubricZoom: local.rubricZoom ?? 1,
  };
}

function buildDeviceLocalTabMap(
  books: ClassBook[],
  localTabMap: Record<string, string>,
  fallbackTabMap?: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const book of books) {
    const validTabIds = new Set(book.tabs.map((t) => t.id));
    const localTid = localTabMap[book.id];
    if (localTid && validTabIds.has(localTid)) {
      out[book.id] = localTid;
      continue;
    }
    const fallbackTid = fallbackTabMap?.[book.id];
    if (fallbackTid && validTabIds.has(fallbackTid)) {
      out[book.id] = fallbackTid;
      continue;
    }
    if (book.tabs[0]?.id) {
      out[book.id] = book.tabs[0].id;
    }
  }
  return out;
}

/**
 * Applies incoming remote data onto the device while preserving 100% of this device's
 * independent aspect settings, column/folder widths, collapsed states, and active screens/tabs.
 */
export function preserveDeviceLocalLayoutAndNav(
  remote: GradebookWorkspace,
  local: GradebookWorkspace
): GradebookWorkspace {
  const localBookMap = new Map<string, ClassBook>(
    [...local.classes, ...local.templates].map((b) => [b.id, b])
  );

  const applyLocalToBook = (rBook: ClassBook): ClassBook => {
    const lBook = localBookMap.get(rBook.id);
    if (!lBook) return rBook;
    const localTabMap = new Map(lBook.tabs.map((t) => [t.id, t]));
    return {
      ...rBook,
      collapsedGroups: lBook.collapsedGroups,
      groupSpacerRows: lBook.groupSpacerRows,
      showLomloeRow: lBook.showLomloeRow,
      tabs: rBook.tabs.map((rTab) => {
        const lTab = localTabMap.get(rTab.id);
        if (!lTab) return rTab;
        const localFolderMap = new Map(lTab.folders.map((f) => [f.id, f]));
        const localColMap = new Map(lTab.columns.map((c) => [c.id, c]));
        return {
          ...rTab,
          folders: rTab.folders.map((rFld) => {
            const lFld = localFolderMap.get(rFld.id);
            return lFld
              ? { ...rFld, width: lFld.width, isCollapsed: lFld.isCollapsed }
              : rFld;
          }),
          columns: rTab.columns.map((rCol) => {
            const lCol = localColMap.get(rCol.id);
            return lCol
              ? {
                  ...rCol,
                  width: lCol.width,
                }
              : rCol;
          }),
        };
      }),
    };
  };

  const classes = remote.classes.map(applyLocalToBook);
  const templates = remote.templates.map(applyLocalToBook);
  const validClassIds = new Set(classes.map((c) => c.id));
  const validTemplateIds = new Set(templates.map((t) => t.id));

  const activeClassId =
    local.activeClassId && validClassIds.has(local.activeClassId)
      ? local.activeClassId
      : remote.activeClassId && validClassIds.has(remote.activeClassId)
        ? remote.activeClassId
        : (classes[0]?.id ?? null);

  const activeTemplateId =
    local.activeTemplateId && validTemplateIds.has(local.activeTemplateId)
      ? local.activeTemplateId
      : remote.activeTemplateId && validTemplateIds.has(remote.activeTemplateId)
        ? remote.activeTemplateId
        : (templates[0]?.id ?? null);

  const activeMode =
    local.activeMode === 'TEMPLATE' && templates.length === 0 ? 'CLASS' : local.activeMode;

  return {
    ...remote,
    classes,
    templates,
    activeMode,
    activeClassId,
    activeTemplateId,
    activeTabByBook: buildDeviceLocalTabMap(
      [...classes, ...templates],
      local.activeTabByBook ?? {},
      remote.activeTabByBook
    ),
    settings: {
      ...local.settings,
      collapsedSchools: local.settings.collapsedSchools ?? {},
      gridZoom: local.settings.gridZoom ?? 1,
      rubricZoom: local.settings.rubricZoom ?? 1,
      globalSummaryRows:
        remote.settings?.globalSummaryRows ??
        classes.find((c) => c.id === activeClassId)?.summaryRows ??
        classes[0]?.summaryRows ??
        local.settings.globalSummaryRows,
    },
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
    activeTabByBook: buildDeviceLocalTabMap(
      [...mergedClasses, ...mergedTemplates],
      local.activeTabByBook ?? {},
      remote.activeTabByBook
    ),
    rubrics: rubricsMerge.items,
    lomloeKeyCompetences: preferLocal
      ? (local.lomloeKeyCompetences ?? remote.lomloeKeyCompetences)
      : (remote.lomloeKeyCompetences ?? local.lomloeKeyCompetences),
    lomloeCurricula:
      curriculaMerge.items.length > 0
        ? curriculaMerge.items
        : (remote.lomloeCurricula ?? local.lomloeCurricula),
    settings: (() => {
      const mergedSettings = mergeSettings(
        base?.settings,
        local.settings,
        remote.settings,
        preferLocal
      );
      const syncedSummaryRows =
        mergedClasses.find((c) => c.id === activeClassId)?.summaryRows ??
        mergedClasses.find((c) => c.summaryRows !== undefined)?.summaryRows ??
        remote.settings?.globalSummaryRows ??
        local.settings.globalSummaryRows;
      return syncedSummaryRows
        ? { ...mergedSettings, globalSummaryRows: syncedSummaryRows }
        : mergedSettings;
    })(),
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
