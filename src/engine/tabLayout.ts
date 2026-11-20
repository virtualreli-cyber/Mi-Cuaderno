import type { ColumnEntity, FolderEntity, TabEntity } from '../types/gradebook';

export type TopLevelItem =
  | { kind: 'COL'; col: ColumnEntity }
  | { kind: 'FOLDER'; folder: FolderEntity; childCols: ColumnEntity[] };

export interface DragItemPayload {
  kind: 'COL' | 'FOLDER';
  id: string;
}

export interface DropTargetPayload {
  kind: 'COL' | 'FOLDER' | 'END_OUTSIDE' | 'START_OUTSIDE';
  id?: string;
  position?: 'BEFORE' | 'AFTER' | 'INSIDE';
}

/**
 * Computes a clean, deduplicated canonical top-level order of folder IDs and
 * standalone (folderId === null) column IDs. Backward-compatible with tabs that
 * were created before `itemOrder` existed.
 */
export function getCanonicalItemOrder(tab: TabEntity): string[] {
  const folderIds = new Set(tab.folders.map((f) => f.id));
  const looseColIds = new Set(
    tab.columns.filter((c) => !c.folderId || !folderIds.has(c.folderId)).map((c) => c.id)
  );
  const validTopLevel = new Set<string>([...folderIds, ...looseColIds]);

  const seen = new Set<string>();
  const order: string[] = [];

  if (tab.itemOrder && tab.itemOrder.length > 0) {
    for (const id of tab.itemOrder) {
      if (validTopLevel.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }

  // Fill any missing items deterministically from column orderIndex, then folder orderIndex
  const sortedCols = [...tab.columns].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const col of sortedCols) {
    const topId = col.folderId && folderIds.has(col.folderId) ? col.folderId : col.id;
    if (validTopLevel.has(topId) && !seen.has(topId)) {
      seen.add(topId);
      order.push(topId);
    }
  }

  const sortedFolders = [...tab.folders].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const f of sortedFolders) {
    if (!seen.has(f.id)) {
      seen.add(f.id);
      order.push(f.id);
    }
  }

  return order;
}

/**
 * Returns the ordered top-level visual structure of a tab: standalone columns
 * interleaved with contiguous folder groups (including empty folders).
 */
export function getTabDisplayOrder(tab: TabEntity): TopLevelItem[] {
  const order = getCanonicalItemOrder(tab);
  const folderMap = new Map(tab.folders.map((f) => [f.id, f]));
  const colMap = new Map(tab.columns.map((c) => [c.id, c]));

  const childrenByFolder = new Map<string, ColumnEntity[]>();
  for (const f of tab.folders) childrenByFolder.set(f.id, []);
  const sortedCols = [...tab.columns].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const c of sortedCols) {
    if (c.folderId && childrenByFolder.has(c.folderId)) {
      childrenByFolder.get(c.folderId)!.push(c);
    }
  }

  const result: TopLevelItem[] = [];
  for (const id of order) {
    const folder = folderMap.get(id);
    if (folder) {
      result.push({
        kind: 'FOLDER',
        folder,
        childCols: childrenByFolder.get(folder.id) ?? [],
      });
      continue;
    }
    const col = colMap.get(id);
    if (col) {
      result.push({ kind: 'COL', col });
    }
  }
  return result;
}

/**
 * Re-synchronizes folder.orderIndex, column.orderIndex, and tab.itemOrder so
 * persisted data stays strictly consistent with visual order.
 */
export function syncTabOrderIndices(tab: TabEntity, desiredItemOrder?: string[]): TabEntity {
  const baseTab = desiredItemOrder ? { ...tab, itemOrder: desiredItemOrder } : tab;
  const order = getCanonicalItemOrder(baseTab);
  const folderMap = new Map(baseTab.folders.map((f) => [f.id, f]));
  const colMap = new Map(baseTab.columns.map((c) => [c.id, c]));

  const childrenByFolder = new Map<string, ColumnEntity[]>();
  for (const f of baseTab.folders) childrenByFolder.set(f.id, []);
  const sortedCols = [...baseTab.columns].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const c of sortedCols) {
    if (c.folderId && childrenByFolder.has(c.folderId)) {
      childrenByFolder.get(c.folderId)!.push(c);
    }
  }

  const nextFolders: FolderEntity[] = [];
  const nextColumns: ColumnEntity[] = [];
  let folderIdx = 0;
  let colIdx = 0;

  for (const id of order) {
    const f = folderMap.get(id);
    if (f) {
      nextFolders.push({ ...f, orderIndex: folderIdx++ });
      for (const child of childrenByFolder.get(f.id) ?? []) {
        nextColumns.push({ ...child, folderId: f.id, orderIndex: colIdx++ });
      }
      continue;
    }
    const c = colMap.get(id);
    if (c) {
      nextColumns.push({ ...c, folderId: null, orderIndex: colIdx++ });
    }
  }

  return {
    ...baseTab,
    folders: nextFolders,
    columns: nextColumns,
    itemOrder: order,
  };
}

/**
 * Moves ANY column or folder to ANY target position in the tab:
 * - Folder onto Folder / Column / Start / End -> moves the entire folder group
 * - Column onto Folder ('INSIDE') -> puts column inside that folder
 * - Column onto Folder ('BEFORE' | 'AFTER') -> pulls column out and places before/after folder
 * - Column onto standalone Column -> pulls column out of folder (if in one) and places before/after target
 * - Column onto foldered Column -> moves column into target's folder before/after target
 * - Column onto 'END_OUTSIDE' / 'START_OUTSIDE' -> pulls column out of folder to end/start
 */
export function moveItemInTab(
  tab: TabEntity,
  drag: DragItemPayload,
  target: DropTargetPayload
): TabEntity {
  const folderIds = new Set(tab.folders.map((f) => f.id));
  const itemOrder = getCanonicalItemOrder(tab);

  const insertInArray = (arr: string[], itemId: string, targetId: string, pos: 'BEFORE' | 'AFTER') => {
    const filtered = arr.filter((x) => x !== itemId);
    const idx = filtered.indexOf(targetId);
    if (idx < 0) return [...filtered, itemId];
    const insertAt = pos === 'AFTER' ? idx + 1 : idx;
    filtered.splice(insertAt, 0, itemId);
    return filtered;
  };

  // CASE 1: Dragging a FOLDER
  if (drag.kind === 'FOLDER') {
    if (!folderIds.has(drag.id)) return tab;

    if (target.kind === 'END_OUTSIDE') {
      const nextOrder = [...itemOrder.filter((x) => x !== drag.id), drag.id];
      return syncTabOrderIndices(tab, nextOrder);
    }
    if (target.kind === 'START_OUTSIDE') {
      const nextOrder = [drag.id, ...itemOrder.filter((x) => x !== drag.id)];
      return syncTabOrderIndices(tab, nextOrder);
    }

    // Resolve target to its top-level ID (if target is a column inside a folder, use that folder's ID)
    let targetTopId: string | null = null;
    if (target.kind === 'FOLDER' && target.id) {
      targetTopId = target.id;
    } else if (target.kind === 'COL' && target.id) {
      const targetCol = tab.columns.find((c) => c.id === target.id);
      if (targetCol) {
        targetTopId =
          targetCol.folderId && folderIds.has(targetCol.folderId) ? targetCol.folderId : targetCol.id;
      }
    }

    if (!targetTopId || targetTopId === drag.id) return tab;

    const fromIdx = itemOrder.indexOf(drag.id);
    const toIdx = itemOrder.indexOf(targetTopId);
    const pos: 'BEFORE' | 'AFTER' =
      target.position === 'BEFORE' || target.position === 'AFTER'
        ? target.position
        : fromIdx < toIdx
          ? 'AFTER'
          : 'BEFORE';

    const nextOrder = insertInArray(itemOrder, drag.id, targetTopId, pos);
    return syncTabOrderIndices(tab, nextOrder);
  }

  // CASE 2: Dragging a COLUMN
  const draggedCol = tab.columns.find((c) => c.id === drag.id);
  if (!draggedCol) return tab;

  // 2A: Pull out of folder to start or end
  if (target.kind === 'END_OUTSIDE') {
    const nextCols = tab.columns.map((c) => (c.id === drag.id ? { ...c, folderId: null } : c));
    const nextOrder = [...itemOrder.filter((x) => x !== drag.id), drag.id];
    return syncTabOrderIndices({ ...tab, columns: nextCols }, nextOrder);
  }
  if (target.kind === 'START_OUTSIDE') {
    const nextCols = tab.columns.map((c) => (c.id === drag.id ? { ...c, folderId: null } : c));
    const nextOrder = [drag.id, ...itemOrder.filter((x) => x !== drag.id)];
    return syncTabOrderIndices({ ...tab, columns: nextCols }, nextOrder);
  }

  // 2B: Dropping Column onto a FOLDER
  if (target.kind === 'FOLDER' && target.id && folderIds.has(target.id)) {
    const pos = target.position ?? 'INSIDE';
    if (pos === 'INSIDE') {
      // Place at end of target folder's children
      const maxOrder = tab.columns.reduce((m, c) => Math.max(m, c.orderIndex), -1);
      const nextCols = tab.columns.map((c) =>
        c.id === drag.id ? { ...c, folderId: target.id!, orderIndex: maxOrder + 1 } : c
      );
      const nextOrder = itemOrder.filter((x) => x !== drag.id);
      return syncTabOrderIndices({ ...tab, columns: nextCols }, nextOrder);
    }

    // Drop BEFORE or AFTER a folder -> make column standalone outside the folder!
    const nextCols = tab.columns.map((c) => (c.id === drag.id ? { ...c, folderId: null } : c));
    const nextOrder = insertInArray(itemOrder, drag.id, target.id, pos);
    return syncTabOrderIndices({ ...tab, columns: nextCols }, nextOrder);
  }

  // 2C: Dropping Column onto another COLUMN
  if (target.kind === 'COL' && target.id && target.id !== drag.id) {
    const targetCol = tab.columns.find((c) => c.id === target.id);
    if (!targetCol) return tab;

    const targetFolderId =
      targetCol.folderId && folderIds.has(targetCol.folderId) ? targetCol.folderId : null;

    if (targetFolderId === null) {
      // Target is a standalone column -> dragged column becomes standalone (pulled out if it was in a folder!)
      const nextCols = tab.columns.map((c) => (c.id === drag.id ? { ...c, folderId: null } : c));
      const fromIdx = itemOrder.indexOf(drag.id);
      const toIdx = itemOrder.indexOf(targetCol.id);
      const pos: 'BEFORE' | 'AFTER' =
        target.position === 'BEFORE' || target.position === 'AFTER'
          ? target.position
          : fromIdx >= 0 && fromIdx < toIdx
            ? 'AFTER'
            : 'BEFORE';

      const nextOrder = insertInArray(itemOrder, drag.id, targetCol.id, pos);
      return syncTabOrderIndices({ ...tab, columns: nextCols }, nextOrder);
    }

    // Target is inside a folder -> insert dragged column inside that folder before/after targetCol
    const siblings = tab.columns
      .filter((c) => c.folderId === targetFolderId && c.id !== drag.id)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    const oldIndexInFolder = tab.columns
      .filter((c) => c.folderId === targetFolderId)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .findIndex((c) => c.id === drag.id);

    const targetIndexInAll = tab.columns
      .filter((c) => c.folderId === targetFolderId)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .findIndex((c) => c.id === targetCol.id);

    const pos: 'BEFORE' | 'AFTER' =
      target.position === 'BEFORE' || target.position === 'AFTER'
        ? target.position
        : oldIndexInFolder >= 0 && oldIndexInFolder < targetIndexInAll
          ? 'AFTER'
          : 'BEFORE';

    const targetSiblingIdx = siblings.findIndex((c) => c.id === targetCol.id);
    const insertAt =
      targetSiblingIdx < 0 ? siblings.length : pos === 'AFTER' ? targetSiblingIdx + 1 : targetSiblingIdx;

    const updatedDragged: ColumnEntity = { ...draggedCol, folderId: targetFolderId };
    siblings.splice(insertAt, 0, updatedDragged);

    const siblingRank = new Map(siblings.map((c, idx) => [c.id, idx]));
    const nextCols = tab.columns.map((c) => {
      if (c.id === drag.id) {
        return { ...c, folderId: targetFolderId, orderIndex: siblingRank.get(c.id) ?? 0 };
      }
      if (c.folderId === targetFolderId) {
        return { ...c, orderIndex: siblingRank.get(c.id) ?? c.orderIndex };
      }
      return c;
    });

    const nextOrder = itemOrder.filter((x) => x !== drag.id);
    return syncTabOrderIndices({ ...tab, columns: nextCols }, nextOrder);
  }

  return tab;
}

/**
 * Moves a column one step left or right. If the column is at the edge of a folder,
 * stepping past the boundary cleanly pulls it OUT of the folder right beside it!
 */
export function stepColumnHorizontally(
  tab: TabEntity,
  colId: string,
  dir: 'LEFT' | 'RIGHT'
): TabEntity {
  const col = tab.columns.find((c) => c.id === colId);
  if (!col) return tab;

  const folderIds = new Set(tab.folders.map((f) => f.id));
  const itemOrder = getCanonicalItemOrder(tab);

  if (col.folderId && folderIds.has(col.folderId)) {
    const siblings = tab.columns
      .filter((c) => c.folderId === col.folderId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const idx = siblings.findIndex((c) => c.id === colId);
    if (idx < 0) return tab;

    if (dir === 'LEFT') {
      if (idx > 0) {
        return moveItemInTab(
          tab,
          { kind: 'COL', id: colId },
          { kind: 'COL', id: siblings[idx - 1].id, position: 'BEFORE' }
        );
      }
      // Step out of folder to its left
      return moveItemInTab(
        tab,
        { kind: 'COL', id: colId },
        { kind: 'FOLDER', id: col.folderId, position: 'BEFORE' }
      );
    }

    if (idx < siblings.length - 1) {
      return moveItemInTab(
        tab,
        { kind: 'COL', id: colId },
        { kind: 'COL', id: siblings[idx + 1].id, position: 'AFTER' }
      );
    }
    // Step out of folder to its right
    return moveItemInTab(
      tab,
      { kind: 'COL', id: colId },
      { kind: 'FOLDER', id: col.folderId, position: 'AFTER' }
    );
  }

  // Standalone column in itemOrder
  const idx = itemOrder.indexOf(colId);
  if (idx < 0) return tab;
  const targetIdx = dir === 'LEFT' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= itemOrder.length) return tab;

  const nextOrder = [...itemOrder];
  [nextOrder[idx], nextOrder[targetIdx]] = [nextOrder[targetIdx], nextOrder[idx]];
  return syncTabOrderIndices(tab, nextOrder);
}

/**
 * Moves a folder one step left or right in the top-level tab layout.
 */
export function stepFolderHorizontally(
  tab: TabEntity,
  folderId: string,
  dir: 'LEFT' | 'RIGHT'
): TabEntity {
  const itemOrder = getCanonicalItemOrder(tab);
  const idx = itemOrder.indexOf(folderId);
  if (idx < 0) return tab;
  const targetIdx = dir === 'LEFT' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= itemOrder.length) return tab;

  const nextOrder = [...itemOrder];
  [nextOrder[idx], nextOrder[targetIdx]] = [nextOrder[targetIdx], nextOrder[idx]];
  return syncTabOrderIndices(tab, nextOrder);
}
