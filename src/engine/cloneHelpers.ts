import { makeId } from './gradeMath';
import type {
  ClassBook,
  ColumnEntity,
  FolderEntity,
  TabEntity,
} from '../types/gradebook';

function remapWeights(
  weights: Record<string, number> | undefined,
  colMap: Map<string, string>
): Record<string, number> {
  if (!weights) return {};
  return Object.fromEntries(
    Object.entries(weights).map(([k, v]) => [colMap.get(k) ?? k, v])
  );
}

export function cloneTabsWithRemappedIds(sourceTabs: TabEntity[]): TabEntity[] {
  const folderMap = new Map<string, string>();
  const colMap = new Map<string, string>();

  for (const tab of sourceTabs) {
    for (const f of tab.folders) folderMap.set(f.id, makeId('fld'));
    for (const c of tab.columns) colMap.set(c.id, makeId('col'));
  }

  return sourceTabs.map((tab) => ({
    ...tab,
    id: makeId('tab'),
    itemOrder: tab.itemOrder
      ? tab.itemOrder.map((id) => folderMap.get(id) ?? colMap.get(id) ?? id)
      : undefined,
    folders: tab.folders.map((f) => ({
      ...f,
      id: folderMap.get(f.id)!,
      columnWeights: f.columnWeights ? remapWeights(f.columnWeights, colMap) : undefined,
    })),
    columns: tab.columns.map((c) => ({
      ...c,
      id: colMap.get(c.id)!,
      folderId: c.folderId ? (folderMap.get(c.folderId) ?? null) : null,
      averageConfig: c.averageConfig
        ? {
            ...c.averageConfig,
            sourceColumnIds: c.averageConfig.sourceColumnIds.map((id) => colMap.get(id) ?? id),
            weights: remapWeights(c.averageConfig.weights, colMap),
          }
        : undefined,
    })),
  }));
}

export function cloneSingleColumn(
  col: ColumnEntity,
  orderIndex: number,
  targetFolderId: string | null = null
): ColumnEntity {
  return {
    ...structuredClone(col),
    id: makeId('col'),
    folderId: targetFolderId,
    orderIndex,
  };
}

export function cloneFolderWithColumns(
  folder: FolderEntity,
  childCols: ColumnEntity[],
  folderOrderIndex: number,
  startColOrderIndex: number
): { folder: FolderEntity; columns: ColumnEntity[] } {
  const newFolderId = makeId('fld');
  const colMap = new Map<string, string>();
  const sortedChildren = [...childCols].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const c of sortedChildren) {
    colMap.set(c.id, makeId('col'));
  }

  const clonedFolder: FolderEntity = {
    ...structuredClone(folder),
    id: newFolderId,
    orderIndex: folderOrderIndex,
    columnWeights: folder.columnWeights ? remapWeights(folder.columnWeights, colMap) : undefined,
  };

  const clonedCols: ColumnEntity[] = sortedChildren.map((c, idx) => ({
    ...structuredClone(c),
    id: colMap.get(c.id)!,
    folderId: newFolderId,
    orderIndex: startColOrderIndex + idx,
    averageConfig: c.averageConfig
      ? {
          ...c.averageConfig,
          sourceColumnIds: c.averageConfig.sourceColumnIds.map((id) => colMap.get(id) ?? id),
          weights: remapWeights(c.averageConfig.weights, colMap),
        }
      : undefined,
  }));

  return { folder: clonedFolder, columns: clonedCols };
}

export function cloneTabEntity(tab: TabEntity, orderIndex: number): TabEntity {
  const [cloned] = cloneTabsWithRemappedIds([tab]);
  return {
    ...cloned,
    orderIndex,
  };
}

export function cloneFolderEntity(folder: FolderEntity, orderIndex: number): FolderEntity {
  return {
    ...structuredClone(folder),
    id: makeId('fld'),
    orderIndex,
  };
}

export function createClassBookFromTemplate(
  template: ClassBook,
  name: string,
  subject: string,
  color: string
): ClassBook {
  const clonedTabs = cloneTabsWithRemappedIds(template.tabs);
  return {
    id: makeId('cls'),
    name: name.trim() || template.name,
    subject: subject.trim() || template.subject,
    year: '2026-2027',
    color: color || template.color,
    passThreshold: template.passThreshold,
    sortMode: template.sortMode,
    isTemplate: false,
    tabs: clonedTabs,
    students: [],
    cells: {},
  };
}
