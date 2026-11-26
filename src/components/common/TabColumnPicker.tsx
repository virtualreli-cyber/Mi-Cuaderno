import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  LayoutGrid,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import { blendWithWhite } from '../../constants/colors';
import { getCanonicalItemOrder } from '../../engine/tabLayout';
import type { ColumnEntity, FolderEntity, TabEntity } from '../../types/gradebook';
import { NumericInput } from './NumericInput';

export interface TabColumnPickerProps {
  tabs: TabEntity[];
  activeTabId?: string | null;
  excludeColumnId?: string;
  /** True when folders themselves can be selected as sources (e.g. AVERAGE formulas) */
  allowFolders?: boolean;
  selectedIds: string[];
  onToggleId: (id: string) => void;
  onToggleMany?: (ids: string[], select: boolean) => void;
  /** Optional weight inputs for checked items (AVERAGE configuration) */
  weights?: Record<string, number>;
  onChangeWeight?: (id: string, value: number) => void;
  ariaLabel: string;
  emptyMessage?: string;
  maxHeightClass?: string;
}

type OrderedTabGroup =
  | { kind: 'FOLDER'; folder: FolderEntity; childCols: ColumnEntity[] }
  | { kind: 'COL'; col: ColumnEntity };

function getColTypeBadge(col: ColumnEntity): {
  label: string;
  className: string;
  Icon: React.FC<{ className?: string }>;
} {
  if (col.type === 'RUBRIC') {
    return {
      label: 'Rúbrica',
      className: 'bg-purple-50 text-purple-800 border-purple-200/80',
      Icon: LayoutGrid,
    };
  }
  if (col.type === 'AVERAGE') {
    return {
      label: 'Media',
      className: 'bg-amber-50 text-amber-800 border-amber-200/80',
      Icon: Calculator,
    };
  }
  return {
    label: col.editorMode && col.editorMode !== 'STANDARD' ? 'Contador' : 'Nota',
    className: 'bg-slate-100 text-slate-600 border-slate-200/80',
    Icon: Pencil,
  };
}

export const TabColumnPicker: React.FC<TabColumnPickerProps> = ({
  tabs,
  activeTabId = null,
  excludeColumnId,
  allowFolders = false,
  selectedIds,
  onToggleId,
  onToggleMany,
  weights,
  onChangeWeight,
  ariaLabel,
  emptyMessage = 'No hay columnas disponibles.',
  maxHeightClass = 'max-h-[320px]',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [openTabIds, setOpenTabIds] = useState<Set<string>>(() => new Set());

  const sortedTabs = useMemo(
    () => [...tabs].sort((a, b) => a.orderIndex - b.orderIndex),
    [tabs]
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const tabStructures = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return sortedTabs.map((tab) => {
      const folderMap = new Map(tab.folders.map((f) => [f.id, f] as const));
      const colMap = new Map(
        tab.columns
          .filter((c) => c.id !== excludeColumnId)
          .map((c) => [c.id, c] as const)
      );
      const order = getCanonicalItemOrder(tab);
      const items: OrderedTabGroup[] = [];
      const seenFolders = new Set<string>();
      const seenCols = new Set<string>();

      const pushFolder = (folder: FolderEntity) => {
        seenFolders.add(folder.id);
        const childCols = tab.columns
          .filter((c) => c.folderId === folder.id && c.id !== excludeColumnId)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        childCols.forEach((c) => seenCols.add(c.id));
        if (allowFolders || childCols.length > 0) {
          items.push({ kind: 'FOLDER', folder, childCols });
        }
      };

      for (const id of order) {
        const folder = folderMap.get(id);
        if (folder && !seenFolders.has(folder.id)) {
          pushFolder(folder);
          continue;
        }
        const col = colMap.get(id);
        if (col && !col.folderId && !seenCols.has(col.id)) {
          seenCols.add(col.id);
          items.push({ kind: 'COL', col });
        }
      }

      // Safety fallback for any unreferenced folders/columns
      for (const f of tab.folders) {
        if (!seenFolders.has(f.id)) pushFolder(f);
      }
      for (const c of tab.columns) {
        if (c.id === excludeColumnId || seenCols.has(c.id)) continue;
        seenCols.add(c.id);
        items.push({ kind: 'COL', col: c });
      }

      // Collect all selectable IDs in this tab (before search filtering)
      const allSelectableIds: string[] = [];
      for (const item of items) {
        if (item.kind === 'FOLDER') {
          if (allowFolders) allSelectableIds.push(item.folder.id);
          item.childCols.forEach((c) => allSelectableIds.push(c.id));
        } else {
          allSelectableIds.push(item.col.id);
        }
      }

      // Apply search query filter
      const filteredItems: OrderedTabGroup[] = q
        ? items.reduce<OrderedTabGroup[]>((acc, item) => {
            if (item.kind === 'COL') {
              const hay = `${tab.title} ${item.col.title} ${item.col.date ?? ''}`.toLowerCase();
              if (hay.includes(q)) acc.push(item);
            } else {
              const folderHay = `${tab.title} ${item.folder.title}`.toLowerCase();
              const folderMatches = folderHay.includes(q);
              const matchingChildren = folderMatches
                ? item.childCols
                : item.childCols.filter((c) =>
                    `${tab.title} ${item.folder.title} ${c.title} ${c.date ?? ''}`
                      .toLowerCase()
                      .includes(q)
                  );
              if ((allowFolders && folderMatches) || matchingChildren.length > 0) {
                acc.push({
                  kind: 'FOLDER',
                  folder: item.folder,
                  childCols: matchingChildren,
                });
              }
            }
            return acc;
          }, [])
        : items;

      const selectedInTab = allSelectableIds.filter((id) => selectedSet.has(id));
      const weightInTab = weights
        ? selectedInTab.reduce((sum, id) => sum + (weights[id] ?? 0), 0)
        : 0;

      return {
        tab,
        items: filteredItems,
        allSelectableIds,
        selectedInTab,
        weightInTab,
      };
    });
  }, [sortedTabs, excludeColumnId, allowFolders, searchQuery, selectedSet, weights]);

  // Fast metadata map for selected chips bar
  const itemMetaMap = useMemo(() => {
    const map = new Map<
      string,
      { id: string; title: string; tabTitle: string; color: string; isFolder: boolean }
    >();
    for (const tab of sortedTabs) {
      for (const f of tab.folders) {
        map.set(f.id, {
          id: f.id,
          title: `Carpeta: ${f.title}`,
          tabTitle: tab.title,
          color: f.color,
          isFolder: true,
        });
      }
      for (const c of tab.columns) {
        map.set(c.id, {
          id: c.id,
          title: c.title,
          tabTitle: tab.title,
          color: c.color,
          isFolder: false,
        });
      }
    }
    return map;
  }, [sortedTabs]);

  const totalSelectableCount = useMemo(
    () => tabStructures.reduce((sum, t) => sum + t.allSelectableIds.length, 0),
    [tabStructures]
  );

  // Initialize open tabs cleanly when the list of tabs / activeTabId changes:
  // Open activeTab (or first non-empty tab) + any tab that already has selected items.
  const tabKeySignature = useMemo(
    () => `${activeTabId ?? ''}::${sortedTabs.map((t) => t.id).join(',')}`,
    [activeTabId, sortedTabs]
  );

  useEffect(() => {
    const initial = new Set<string>();
    const nonEmptyTabs = tabStructures.filter((ts) => ts.allSelectableIds.length > 0);
    for (const ts of nonEmptyTabs) {
      if (ts.selectedInTab.length > 0) {
        initial.add(ts.tab.id);
      }
    }
    if (activeTabId && nonEmptyTabs.some((ts) => ts.tab.id === activeTabId)) {
      initial.add(activeTabId);
    } else if (initial.size === 0 && nonEmptyTabs.length > 0) {
      initial.add(nonEmptyTabs[0].tab.id);
    }
    setOpenTabIds(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKeySignature]);

  const visibleTabs = useMemo(
    () =>
      searchQuery.trim()
        ? tabStructures.filter((ts) => ts.items.length > 0)
        : tabStructures.filter((ts) => ts.allSelectableIds.length > 0),
    [tabStructures, searchQuery]
  );

  const isFiltering = Boolean(searchQuery.trim());

  const allExpanded =
    visibleTabs.length > 0 && visibleTabs.every((ts) => openTabIds.has(ts.tab.id));

  const toggleExpandAll = () => {
    if (allExpanded) {
      setOpenTabIds(new Set());
    } else {
      setOpenTabIds(new Set(visibleTabs.map((ts) => ts.tab.id)));
    }
  };

  if (totalSelectableCount === 0) {
    return <p className="text-slate-500 italic py-1">{emptyMessage}</p>;
  }

  const renderColumnRow = (col: ColumnEntity, isNestedInFolder: boolean) => {
    const checked = selectedSet.has(col.id);
    const badge = getColTypeBadge(col);
    const BadgeIcon = badge.Icon;
    return (
      <div
        key={col.id}
        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border transition-colors ${
          checked
            ? 'bg-blue-50/70 border-blue-300 shadow-2xs'
            : isNestedInFolder
              ? 'bg-white border-slate-200/80 hover:border-slate-300'
              : 'bg-white border-slate-200 hover:border-slate-300'
        }`}
      >
        <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleId(col.id)}
            className="accent-blue-600 w-3.5 h-3.5 rounded shrink-0 cursor-pointer"
          />
          <span
            aria-hidden="true"
            className="color-swatch-essential w-2 h-5 rounded-full border border-black/10 shrink-0"
            style={{ backgroundColor: col.color }}
          />
          <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
            <span
              className={`truncate font-semibold ${
                checked ? 'text-blue-950' : 'text-slate-800'
              }`}
            >
              {col.title}
            </span>
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold shrink-0 ${badge.className}`}
            >
              <BadgeIcon className="w-2.5 h-2.5" />
              <span>{badge.label}</span>
            </span>
            {col.date && (
              <span className="text-[10px] text-slate-400 font-medium shrink-0">
                {col.date}
              </span>
            )}
          </div>
        </label>

        {checked && weights && onChangeWeight && (
          <div className="flex items-center gap-1 shrink-0">
            <NumericInput
              min={0}
              aria-label={`Peso porcentual de ${col.title}`}
              value={weights[col.id] ?? 0}
              onChange={(val) => onChangeWeight(col.id, val)}
              className="w-16 border border-blue-300 rounded-lg px-2 py-1 text-right font-bold text-slate-900 bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <span className="text-slate-500 font-semibold">%</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2.5" aria-label={ariaLabel}>
      {/* Compact Selected Summary Chips (always visible even when tabs are collapsed) */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-xl bg-white/90 border border-slate-200/90 max-h-20 overflow-y-auto">
          {selectedIds.map((id) => {
            const meta = itemMetaMap.get(id);
            if (!meta) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-lg bg-blue-50 border border-blue-200/90 text-[11px] font-semibold text-blue-950 max-w-[220px]"
              >
                <span
                  aria-hidden="true"
                  className="color-swatch-essential w-2 h-2 rounded-full border border-black/15 shrink-0"
                  style={{ backgroundColor: meta.color }}
                />
                <span className="truncate">{meta.title}</span>
                {weights && (
                  <span className="text-blue-700 font-bold tabular-nums shrink-0">
                    {weights[id] ?? 0}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onToggleId(id)}
                  aria-label={`Quitar ${meta.title}`}
                  className="p-0.5 rounded hover:bg-blue-200/70 text-blue-700 shrink-0"
                >
                  <X className="w-2.5 h-2.5" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Utility Bar: Search Filter + Expand/Collapse All */}
      {(totalSelectableCount >= 6 || visibleTabs.length >= 2) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {totalSelectableCount >= 6 ? (
            <div className="relative flex-1 min-w-[180px]">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar por nombre o pestaña..."
                aria-label="Filtrar columnas"
                className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpiar filtro"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          ) : (
            <span />
          )}

          {!isFiltering && visibleTabs.length >= 2 && (
            <button
              type="button"
              aria-expanded={allExpanded}
              onClick={toggleExpandAll}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1.5 transition-colors shrink-0"
            >
              {allExpanded ? (
                <>
                  <ChevronsDownUp className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                  <span>Plegar pestañas</span>
                </>
              ) : (
                <>
                  <ChevronsUpDown className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                  <span>Desplegar todas ({visibleTabs.length})</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Collapsible Tab Accordion List */}
      {visibleTabs.length === 0 ? (
        <div className="py-4 px-3 rounded-xl border border-dashed border-slate-200 bg-white/70 text-center text-slate-500">
          No hay resultados para «{searchQuery.trim()}».
        </div>
      ) : (
        <div className={`${maxHeightClass} overflow-y-auto space-y-2 pr-0.5`}>
          {visibleTabs.map(({ tab, items, allSelectableIds, selectedInTab, weightInTab }) => {
            const isOpen = isFiltering || openTabIds.has(tab.id);
            const isActiveTab = tab.id === activeTabId;
            const allInTabSelected =
              allSelectableIds.length > 0 && selectedInTab.length === allSelectableIds.length;

            return (
              <details
                key={tab.id}
                open={isOpen}
                onToggle={(e) => {
                  if (isFiltering) return;
                  const nextOpen = e.currentTarget.open;
                  setOpenTabIds((prev) => {
                    if (prev.has(tab.id) === nextOpen) return prev;
                    const next = new Set(prev);
                    if (nextOpen) next.add(tab.id);
                    else next.delete(tab.id);
                    return next;
                  });
                }}
                className="tab-accordion-details rounded-xl border border-slate-200/90 bg-white overflow-hidden shadow-2xs"
              >
                <summary
                  style={{
                    backgroundColor: blendWithWhite(tab.color, 0.7),
                  }}
                  className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer select-none hover:brightness-97 transition-[filter] border-b border-transparent [[open]>&]:border-slate-200/80"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <ChevronDown
                      className="tab-accordion-chevron w-4 h-4 text-slate-600 shrink-0"
                      aria-hidden="true"
                    />
                    <span
                      aria-hidden="true"
                      className="color-swatch-essential w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                      style={{ backgroundColor: tab.color }}
                    />
                    <span className="font-bold text-slate-900 truncate">{tab.title}</span>
                    {isActiveTab && (
                      <span className="px-1.5 py-0.5 rounded-md bg-white/85 border border-slate-300/80 text-[10px] font-bold text-slate-700 shrink-0">
                        Actual
                      </span>
                    )}
                  </span>

                  <span className="flex items-center gap-1.5 shrink-0">
                    {selectedInTab.length > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10.5px] font-bold tabular-nums">
                        <Check className="w-2.5 h-2.5 stroke-[3]" aria-hidden="true" />
                        <span>
                          {selectedInTab.length}/{allSelectableIds.length}
                          {weights ? ` · ${weightInTab.toFixed(0)}%` : ''}
                        </span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-white/80 border border-black/10 text-[10.5px] font-semibold text-slate-600 tabular-nums">
                        {allSelectableIds.length}{' '}
                        {allSelectableIds.length === 1 ? 'col.' : 'cols.'}
                      </span>
                    )}
                  </span>
                </summary>

                <div className="p-2.5 space-y-2 bg-slate-50/45">
                  {/* Per-tab quick select/clear action */}
                  {onToggleMany && allSelectableIds.length > 1 && !isFiltering && (
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10.5px] font-medium text-slate-500">
                        {selectedInTab.length > 0
                          ? `${selectedInTab.length} de ${allSelectableIds.length} seleccionadas`
                          : `${allSelectableIds.length} elementos en esta pestaña`}
                      </span>
                      <button
                        type="button"
                        onClick={() => onToggleMany(allSelectableIds, !allInTabSelected)}
                        className="text-[11px] font-semibold text-blue-700 hover:underline"
                      >
                        {allInTabSelected ? 'Quitar todas de esta pestaña' : 'Seleccionar toda la pestaña'}
                      </button>
                    </div>
                  )}

                  {items.map((item) => {
                    if (item.kind === 'COL') {
                      return renderColumnRow(item.col, false);
                    }

                    const { folder, childCols } = item;
                    const folderChecked = selectedSet.has(folder.id);
                    const childIds = childCols.map((c) => c.id);
                    const selectedChildCount = childIds.filter((id) => selectedSet.has(id)).length;
                    const allChildrenSelected =
                      childIds.length > 0 && selectedChildCount === childIds.length;

                    return (
                      <div
                        key={folder.id}
                        className={`rounded-xl border overflow-hidden ${
                          folderChecked
                            ? 'border-blue-300 bg-blue-50/40'
                            : 'border-slate-200/90 bg-white/80'
                        }`}
                      >
                        {/* Folder Row Header */}
                        <div
                          style={{
                            backgroundColor: folderChecked
                              ? '#EFF6FF'
                              : blendWithWhite(folder.color, 0.72),
                          }}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-slate-200/70"
                        >
                          {allowFolders ? (
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={folderChecked}
                                onChange={() => onToggleId(folder.id)}
                                className="accent-blue-600 w-3.5 h-3.5 rounded shrink-0 cursor-pointer"
                              />
                              <Folder
                                className="w-3.5 h-3.5 text-slate-700 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="font-bold text-slate-900 truncate">
                                {folder.title}
                              </span>
                              <span className="px-1.5 py-0.5 rounded-md bg-white/80 border border-black/10 text-[10px] font-semibold text-slate-600 shrink-0">
                                Carpeta · {childCols.length}
                              </span>
                            </label>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <Folder
                                className="w-3.5 h-3.5 text-slate-700 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="font-bold text-slate-800 truncate">
                                {folder.title}
                              </span>
                              <span className="px-1.5 py-0.5 rounded-md bg-white/80 border border-black/10 text-[10px] font-semibold text-slate-600 shrink-0">
                                {childCols.length} {childCols.length === 1 ? 'col.' : 'cols.'}
                              </span>
                            </div>
                          )}

                          {allowFolders && folderChecked && weights && onChangeWeight && (
                            <div className="flex items-center gap-1 shrink-0">
                              <NumericInput
                                min={0}
                                aria-label={`Peso porcentual de carpeta ${folder.title}`}
                                value={weights[folder.id] ?? 0}
                                onChange={(val) => onChangeWeight(folder.id, val)}
                                className="w-16 border border-blue-300 rounded-lg px-2 py-1 text-right font-bold text-slate-900 bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                              />
                              <span className="text-slate-500 font-semibold">%</span>
                            </div>
                          )}

                          {!allowFolders && onToggleMany && childIds.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onToggleMany(childIds, !allChildrenSelected)}
                              className="text-[10.5px] font-semibold text-blue-700 hover:underline shrink-0"
                            >
                              {allChildrenSelected ? 'Quitar' : 'Todas'}
                            </button>
                          )}
                        </div>

                        {/* Indented Child Columns */}
                        {childCols.length > 0 && (
                          <div className="p-2 pl-3 space-y-1.5 bg-white/60">
                            <div
                              style={{ borderLeftColor: folder.color }}
                              className="pl-2.5 border-l-2 space-y-1.5"
                            >
                              {childCols.map((c) => renderColumnRow(c, true))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
};
