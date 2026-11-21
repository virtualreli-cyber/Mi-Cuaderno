import type { ClassBook, GradebookWorkspace, ViewSettings } from '../types/gradebook';

export interface CellFocusTarget {
  bookId: string;
  tabId?: string;
  studentId: string;
  columnId: string;
}

export interface UndoneCellTarget extends CellFocusTarget {
  seq: number;
}

export interface AspectUndoSnapshot {
  settings: ViewSettings;
  columnWidths: Record<string, number>;
  folderWidths: Record<string, number>;
  bookAspect: Record<string, { groupSpacerRows?: number; showLomloeRow?: boolean }>;
}

const ASPECT_SETTINGS_KEYS = new Set<keyof ViewSettings>([
  'rowHeight',
  'headerHeight',
  'studentColWidth',
  'nameFormat',
  'showStatsRow',
  'showRubricsAsPercent',
  'gridZoom',
  'rubricZoom',
  'gradeFontSize',
  'textFontSize',
  'iconSize',
  'groupSpacerHeight',
  'summaryRowHeight',
  'defaultColumnWidth',
  'defaultFolderWidth',
  'showLomloeRow',
]);

export function isAspectSettingsPatch(patch: Partial<ViewSettings>): boolean {
  return (Object.keys(patch) as Array<keyof ViewSettings>).some((k) =>
    ASPECT_SETTINGS_KEYS.has(k)
  );
}

export function isAspectBookPatch(patch: Partial<ClassBook>): boolean {
  const keys = Object.keys(patch);
  if (keys.length === 0) return false;
  return keys.every((k) => k === 'groupSpacerRows' || k === 'showLomloeRow');
}

function copyAspectSettings(target: ViewSettings, source: ViewSettings): ViewSettings {
  return {
    ...target,
    rowHeight: source.rowHeight,
    headerHeight: source.headerHeight,
    studentColWidth: source.studentColWidth,
    nameFormat: source.nameFormat,
    showStatsRow: source.showStatsRow,
    showRubricsAsPercent: source.showRubricsAsPercent,
    gridZoom: source.gridZoom,
    rubricZoom: source.rubricZoom,
    gradeFontSize: source.gradeFontSize,
    textFontSize: source.textFontSize,
    iconSize: source.iconSize,
    groupSpacerHeight: source.groupSpacerHeight,
    summaryRowHeight: source.summaryRowHeight,
    defaultColumnWidth: source.defaultColumnWidth,
    defaultFolderWidth: source.defaultFolderWidth,
    showLomloeRow: source.showLomloeRow,
  };
}

export function captureAspectSnapshot(ws: GradebookWorkspace): AspectUndoSnapshot {
  const columnWidths: Record<string, number> = {};
  const folderWidths: Record<string, number> = {};
  const bookAspect: Record<string, { groupSpacerRows?: number; showLomloeRow?: boolean }> = {};

  for (const book of [...ws.classes, ...ws.templates]) {
    bookAspect[book.id] = {
      groupSpacerRows: book.groupSpacerRows,
      showLomloeRow: book.showLomloeRow,
    };
    for (const tab of book.tabs) {
      for (const col of tab.columns) {
        columnWidths[`${book.id}::${tab.id}::${col.id}`] = col.width;
      }
      for (const folder of tab.folders) {
        if (typeof folder.width === 'number') {
          folderWidths[`${book.id}::${tab.id}::${folder.id}`] = folder.width;
        }
      }
    }
  }

  return {
    settings: { ...ws.settings },
    columnWidths,
    folderWidths,
    bookAspect,
  };
}

export function aspectSnapshotsEqual(a: AspectUndoSnapshot, b: AspectUndoSnapshot): boolean {
  for (const key of ASPECT_SETTINGS_KEYS) {
    if (a.settings[key] !== b.settings[key]) return false;
  }
  const aCols = Object.keys(a.columnWidths);
  const bCols = Object.keys(b.columnWidths);
  if (aCols.length !== bCols.length) return false;
  for (const k of aCols) {
    if (a.columnWidths[k] !== b.columnWidths[k]) return false;
  }
  const aFolders = Object.keys(a.folderWidths);
  const bFolders = Object.keys(b.folderWidths);
  if (aFolders.length !== bFolders.length) return false;
  for (const k of aFolders) {
    if (a.folderWidths[k] !== b.folderWidths[k]) return false;
  }
  const aBooks = Object.keys(a.bookAspect);
  const bBooks = Object.keys(b.bookAspect);
  if (aBooks.length !== bBooks.length) return false;
  for (const k of aBooks) {
    if (
      a.bookAspect[k]?.groupSpacerRows !== b.bookAspect[k]?.groupSpacerRows ||
      a.bookAspect[k]?.showLomloeRow !== b.bookAspect[k]?.showLomloeRow
    ) {
      return false;
    }
  }
  return true;
}

function applyAspectToBook(book: ClassBook, snapshot: AspectUndoSnapshot): ClassBook {
  const bAsp = snapshot.bookAspect[book.id];
  return {
    ...book,
    ...(bAsp
      ? {
          groupSpacerRows: bAsp.groupSpacerRows,
          showLomloeRow: bAsp.showLomloeRow,
        }
      : {}),
    tabs: book.tabs.map((tab) => ({
      ...tab,
      columns: tab.columns.map((col) => {
        const w = snapshot.columnWidths[`${book.id}::${tab.id}::${col.id}`];
        return w !== undefined && w !== col.width ? { ...col, width: w } : col;
      }),
      folders: tab.folders.map((folder) => {
        const k = `${book.id}::${tab.id}::${folder.id}`;
        if (k in snapshot.folderWidths) {
          const w = snapshot.folderWidths[k];
          return w !== folder.width ? { ...folder, width: w } : folder;
        }
        return folder;
      }),
    })),
  };
}

export function applyAspectSnapshot(
  ws: GradebookWorkspace,
  snapshot: AspectUndoSnapshot
): GradebookWorkspace {
  return {
    ...ws,
    settings: copyAspectSettings(ws.settings, snapshot.settings),
    classes: ws.classes.map((c) => applyAspectToBook(c, snapshot)),
    templates: ws.templates.map((t) => applyAspectToBook(t, snapshot)),
  };
}

/**
 * When executing a Data Undo, keep the current visual/aspect settings and widths
 * so Cmd+Z only reverts data changes (grades, students, columns, etc.) and
 * never undoes view/aspect changes.
 */
export function preserveCurrentAspectOnDataUndo(
  restoredWs: GradebookWorkspace,
  currentWs: GradebookWorkspace
): GradebookWorkspace {
  const currentSnapshot = captureAspectSnapshot(currentWs);
  const applied = applyAspectSnapshot(restoredWs, currentSnapshot);
  return {
    ...applied,
    settings: {
      ...applied.settings,
      sidebarVisible: currentWs.settings.sidebarVisible,
      collapsedSchools: currentWs.settings.collapsedSchools,
    },
  };
}

export function resolveBookIdAndTabIdForColumn(
  ws: GradebookWorkspace,
  columnId: string
): { bookId: string; tabId?: string } | null {
  const activeId =
    ws.activeMode === 'TEMPLATE'
      ? (ws.activeTemplateId ?? ws.templates[0]?.id)
      : (ws.activeClassId ?? ws.classes[0]?.id);
  const allBooks = [...ws.classes, ...ws.templates];
  const activeBook = allBooks.find((b) => b.id === activeId);
  if (activeBook) {
    const tab = activeBook.tabs.find((t) => t.columns.some((c) => c.id === columnId));
    if (tab) return { bookId: activeBook.id, tabId: tab.id };
    return { bookId: activeBook.id, tabId: ws.activeTabByBook[activeBook.id] };
  }
  return null;
}

export function findFirstChangedCellTarget(
  currentWs: GradebookWorkspace,
  restoredWs: GradebookWorkspace
): CellFocusTarget | null {
  const currentActiveId =
    currentWs.activeMode === 'TEMPLATE'
      ? (currentWs.activeTemplateId ?? currentWs.templates[0]?.id)
      : (currentWs.activeClassId ?? currentWs.classes[0]?.id);

  const currentBooks = [...currentWs.classes, ...currentWs.templates];
  const restoredBooksMap = new Map(
    [...restoredWs.classes, ...restoredWs.templates].map((b) => [b.id, b])
  );

  // Check active book first, then any other book
  const orderedBooks = [
    ...currentBooks.filter((b) => b.id === currentActiveId),
    ...currentBooks.filter((b) => b.id !== currentActiveId),
  ];

  for (const curBook of orderedBooks) {
    const resBook = restoredBooksMap.get(curBook.id);
    if (!resBook) continue;
    const allKeys = new Set([...Object.keys(curBook.cells), ...Object.keys(resBook.cells)]);
    for (const key of allKeys) {
      const a = curBook.cells[key];
      const b = resBook.cells[key];
      if (
        (a?.grade ?? null) !== (b?.grade ?? null) ||
        (a?.comment ?? '') !== (b?.comment ?? '') ||
        (a?.manualOverride ?? null) !== (b?.manualOverride ?? null) ||
        JSON.stringify(a?.rubricEval ?? null) !== JSON.stringify(b?.rubricEval ?? null)
      ) {
        const sepIdx = key.indexOf('::');
        if (sepIdx <= 0) continue;
        const studentId = key.slice(0, sepIdx);
        const columnId = key.slice(sepIdx + 2);
        const tab = resBook.tabs.find((t) => t.columns.some((c) => c.id === columnId));
        return {
          bookId: resBook.id,
          tabId: tab?.id ?? restoredWs.activeTabByBook[resBook.id],
          studentId,
          columnId,
        };
      }
    }
  }
  return null;
}
