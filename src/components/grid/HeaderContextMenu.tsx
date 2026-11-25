import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownUp,
  ArrowRightLeft,
  Calculator,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCopy,
  Copy,
  FileX2,
  Folder,
  FolderOutput,
  LayoutGrid,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { blendWithWhite } from '../../constants/colors';
import type { ColumnEntity, ColumnType, FolderEntity, TabEntity } from '../../types/gradebook';

export type HeaderContextMenuTarget =
  | {
      kind: 'COL';
      col: ColumnEntity;
      selectedColIds: string[];
      emptyNpCount: number;
      canEditGrades: boolean;
      x: number;
      y: number;
    }
  | {
      kind: 'FOLDER';
      folder: FolderEntity;
      childCols: ColumnEntity[];
      emptyFolderNpCount: number;
      editableChildColIds: string[];
      x: number;
      y: number;
    };

interface HeaderContextMenuProps {
  target: HeaderContextMenuTarget | null;
  activeTab: TabEntity;
  otherTabs: TabEntity[];
  isTabLocked: boolean;
  onClose: () => void;
  onNewColumn: (presetType: ColumnType, folderId: string | null) => void;
  onEditColumn: (col: ColumnEntity) => void;
  onCopyColumnsToClass?: (columnIds: string[]) => void;
  onMoveColumnsToTab: (columnIds: string[], targetTabId: string) => void;
  onDuplicateColumn: (colId: string) => void;
  onCopyColumnGrades: (col: ColumnEntity) => void;
  onBatchAdjustColumn: (col: ColumnEntity) => void;
  onFillEmptyWithNP: (colIds: string[], label: string) => void;
  onRemoveFromFolder: (colId: string) => void;
  onToggleColumnLock: (col: ColumnEntity) => void;
  onDeleteColumn: (col: ColumnEntity) => void;
  onEditFolder: (folder: FolderEntity) => void;
  onToggleFolderCollapse: (folder: FolderEntity) => void;
  onCopyFolderGrades: (folder: FolderEntity, childCols: ColumnEntity[]) => void;
  onDeleteFolder: (folder: FolderEntity) => void;
}

export const HeaderContextMenu: React.FC<HeaderContextMenuProps> = ({
  target,
  activeTab,
  otherTabs,
  isTabLocked,
  onClose,
  onNewColumn,
  onEditColumn,
  onCopyColumnsToClass,
  onMoveColumnsToTab,
  onDuplicateColumn,
  onCopyColumnGrades,
  onBatchAdjustColumn,
  onFillEmptyWithNP,
  onRemoveFromFolder,
  onToggleColumnLock,
  onDeleteColumn,
  onEditFolder,
  onToggleFolderCollapse,
  onCopyFolderGrades,
  onDeleteFolder,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  const [moveTabExpanded, setMoveTabExpanded] = useState(false);

  useEffect(() => {
    setMoveTabExpanded(false);
  }, [target]);

  // Measure actual rendered size and clamp cleanly within the viewport
  useLayoutEffect(() => {
    if (!target || !menuRef.current) return;
    const el = menuRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth || 256;
    const h = el.offsetHeight || 320;
    const pad = 10;

    let left = target.x;
    if (left + w > vw - pad) {
      left = Math.max(pad, target.x - w);
    }
    left = Math.max(pad, Math.min(vw - w - pad, left));

    let top = target.y;
    if (top + h > vh - pad) {
      top = Math.max(pad, target.y - h);
    }
    top = Math.max(pad, Math.min(vh - h - pad, top));

    setPos({ left, top });
  }, [target, moveTabExpanded]);

  // Move focus to first menuitem on open and handle Escape
  useEffect(() => {
    if (!target) return;
    requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')
        ?.focus({ preventScroll: true });
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [target, onClose]);

  if (!target || typeof document === 'undefined') return null;

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)'
      ) ?? []
    );
    if (items.length === 0) return;
    e.preventDefault();
    const cur = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = cur < 0 ? 0 : (cur + 1) % items.length;
    else if (e.key === 'ArrowUp') next = cur <= 0 ? items.length - 1 : cur - 1;
    items[next]?.focus({ preventScroll: true });
  };

  const renderQuickAddRow = (folderId: string | null, heading: string) => (
    <div className="px-2.5 py-2 border-b border-slate-100 bg-slate-50/70 space-y-1.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-0.5">
        {heading}
      </div>
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          role="menuitem"
          disabled={isTabLocked}
          onClick={() => {
            onClose();
            onNewColumn('NUMERIC', folderId);
          }}
          className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/70 disabled:opacity-40 text-slate-800 font-semibold flex flex-col items-center gap-0.5 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
          <span className="text-[10.5px]">Nota</span>
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={isTabLocked}
          onClick={() => {
            onClose();
            onNewColumn('AVERAGE', folderId);
          }}
          className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-amber-400 hover:bg-amber-50/70 disabled:opacity-40 text-slate-800 font-semibold flex flex-col items-center gap-0.5 transition-colors"
        >
          <Calculator className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
          <span className="text-[10.5px]">Media</span>
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={isTabLocked}
          onClick={() => {
            onClose();
            onNewColumn('RUBRIC', folderId);
          }}
          className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-purple-400 hover:bg-purple-50/70 disabled:opacity-40 text-slate-800 font-semibold flex flex-col items-center gap-0.5 transition-colors"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-purple-600" aria-hidden="true" />
          <span className="text-[10.5px]">Rúbrica</span>
        </button>
      </div>
    </div>
  );

  const itemBtnClass =
    'w-full px-3 py-1.5 text-left hover:bg-slate-100/90 focus:bg-blue-50 focus:outline-none disabled:opacity-40 flex items-center justify-between gap-2 text-slate-800 font-medium transition-colors';

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={
        target.kind === 'COL'
          ? `Acciones rápidas para ${target.col.title}`
          : `Acciones rápidas para carpeta ${target.folder.title}`
      }
      data-header-context-menu="true"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={handleMenuKeyDown}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 90,
      }}
      className="w-[262px] max-h-[min(82dvh,520px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl text-xs select-none"
    >
      {target.kind === 'COL' ? (() => {
        const { col, selectedColIds, emptyNpCount, canEditGrades } = target;
        const isMulti = selectedColIds.length > 1;
        const actionIds = isMulti ? selectedColIds : [col.id];
        const parentFolder = col.folderId
          ? activeTab.folders.find((f) => f.id === col.folderId) ?? null
          : null;

        return (
          <>
            {/* Header Strip */}
            <div
              style={{ backgroundColor: blendWithWhite(col.color, 0.55) }}
              className="px-3 py-2 border-b border-slate-200/80 flex items-center gap-2"
            >
              <span
                aria-hidden="true"
                className="color-swatch-essential w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                style={{ backgroundColor: col.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900 truncate">
                  {isMulti ? `${selectedColIds.length} columnas seleccionadas` : col.title}
                </div>
                <div className="text-[10.5px] text-slate-600 truncate">
                  {isMulti
                    ? `Incluye «${col.title}»`
                    : parentFolder
                      ? `En carpeta: ${parentFolder.title}`
                      : col.type === 'RUBRIC'
                        ? 'Columna de rúbrica'
                        : col.type === 'AVERAGE'
                          ? 'Columna calculada'
                          : 'Columna numérica'}
                </div>
              </div>
            </div>

            {/* Quick Add Column (iDoceo-style) */}
            {renderQuickAddRow(
              col.folderId,
              parentFolder
                ? `Añadir columna en «${parentFolder.title}»`
                : 'Añadir nueva columna'
            )}

            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onEditColumn(col);
                }}
                className={itemBtnClass}
              >
                <span className="flex items-center gap-2">
                  <Pencil className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>Editar columna</span>
                </span>
              </button>

              {onCopyColumnsToClass && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onClose();
                    onCopyColumnsToClass(actionIds);
                  }}
                  className={itemBtnClass}
                >
                  <span className="flex items-center gap-2">
                    <Send className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                    <span>
                      {isMulti
                        ? `Copiar ${selectedColIds.length} cols. a clases / pestañas...`
                        : 'Copiar a clases / pestañas...'}
                    </span>
                  </span>
                </button>
              )}

              {otherTabs.length > 0 && !isTabLocked && (
                <div>
                  <button
                    type="button"
                    role="menuitem"
                    aria-expanded={moveTabExpanded}
                    onClick={() => setMoveTabExpanded((v) => !v)}
                    className={itemBtnClass}
                  >
                    <span className="flex items-center gap-2">
                      <ArrowRightLeft
                        className="w-3.5 h-3.5 text-indigo-600 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        {isMulti
                          ? `Mover ${selectedColIds.length} cols. a pestaña`
                          : 'Mover a otra pestaña'}
                      </span>
                    </span>
                    {moveTabExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    )}
                  </button>
                  {moveTabExpanded && (
                    <div className="mx-2 my-1 p-1 rounded-xl bg-slate-50 border border-slate-200/80 space-y-0.5">
                      {otherTabs.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onClose();
                            onMoveColumnsToTab(actionIds, t.id);
                          }}
                          className="w-full px-2 py-1.5 rounded-lg hover:bg-indigo-50 hover:text-indigo-900 text-left flex items-center gap-2 text-[11.5px] font-semibold text-slate-700 transition-colors"
                        >
                          <span
                            aria-hidden="true"
                            className="color-swatch-essential w-2 h-2 rounded-full border border-black/15 shrink-0"
                            style={{ backgroundColor: t.color }}
                          />
                          <span className="truncate">{t.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!isMulti && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isTabLocked}
                    onClick={() => {
                      onClose();
                      onDuplicateColumn(col.id);
                    }}
                    className={itemBtnClass}
                  >
                    <span className="flex items-center gap-2">
                      <Copy className="w-3.5 h-3.5 text-slate-600 shrink-0" aria-hidden="true" />
                      <span>Duplicar columna</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onClose();
                      onCopyColumnGrades(col);
                    }}
                    className={itemBtnClass}
                  >
                    <span className="flex items-center gap-2">
                      <ClipboardCopy
                        className="w-3.5 h-3.5 text-slate-600 shrink-0"
                        aria-hidden="true"
                      />
                      <span>Copiar notas (A–Z)</span>
                    </span>
                  </button>
                </>
              )}

              {!isMulti && canEditGrades && (
                <>
                  <hr className="my-1 border-slate-100" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onClose();
                      onBatchAdjustColumn(col);
                    }}
                    className={itemBtnClass}
                  >
                    <span className="flex items-center gap-2">
                      <ArrowDownUp
                        className="w-3.5 h-3.5 text-amber-600 shrink-0"
                        aria-hidden="true"
                      />
                      <span>Ajustar notas (±) y comentar</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={emptyNpCount === 0}
                    onClick={() => {
                      onClose();
                      onFillEmptyWithNP([col.id], col.title);
                    }}
                    className={itemBtnClass}
                  >
                    <span className="flex items-center gap-2">
                      <FileX2
                        className="w-3.5 h-3.5 text-indigo-600 shrink-0"
                        aria-hidden="true"
                      />
                      <span>Rellenar vacías: 0 NP ({emptyNpCount})</span>
                    </span>
                  </button>
                </>
              )}

              {!isMulti && (
                <>
                  <hr className="my-1 border-slate-100" />
                  {col.folderId && !isTabLocked && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onClose();
                        onRemoveFromFolder(col.id);
                      }}
                      className={itemBtnClass}
                    >
                      <span className="flex items-center gap-2">
                        <FolderOutput
                          className="w-3.5 h-3.5 text-amber-600 shrink-0"
                          aria-hidden="true"
                        />
                        <span>Sacar de carpeta</span>
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onClose();
                      onToggleColumnLock(col);
                    }}
                    className={itemBtnClass}
                  >
                    <span className="flex items-center gap-2">
                      {col.isLocked ? (
                        <LockOpen
                          className="w-3.5 h-3.5 text-slate-600 shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <Lock
                          className="w-3.5 h-3.5 text-slate-600 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span>{col.isLocked ? 'Desbloquear columna' : 'Bloquear columna'}</span>
                    </span>
                  </button>

                  {!isTabLocked && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onClose();
                        onDeleteColumn(col);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-rose-50 focus:bg-rose-50 focus:outline-none flex items-center gap-2 text-rose-600 font-semibold transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Eliminar columna</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        );
      })() : (() => {
        const { folder, childCols, emptyFolderNpCount, editableChildColIds } = target;
        return (
          <>
            {/* Folder Header Strip */}
            <div
              style={{ backgroundColor: blendWithWhite(folder.color, 0.52) }}
              className="px-3 py-2 border-b border-slate-200/80 flex items-center gap-2"
            >
              <Folder className="w-4 h-4 text-slate-700 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900 truncate">{folder.title}</div>
                <div className="text-[10.5px] text-slate-600">
                  Carpeta · {childCols.length} {childCols.length === 1 ? 'columna' : 'columnas'}
                </div>
              </div>
            </div>

            {/* Quick Add inside Folder */}
            {renderQuickAddRow(folder.id, `Añadir columna en «${folder.title}»`)}

            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                disabled={isTabLocked}
                onClick={() => {
                  onClose();
                  onNewColumn('NUMERIC', null);
                }}
                className={itemBtnClass}
              >
                <span className="flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>Añadir columna suelta</span>
                </span>
              </button>

              <hr className="my-1 border-slate-100" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onEditFolder(folder);
                }}
                className={itemBtnClass}
              >
                <span className="flex items-center gap-2">
                  <Pencil className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>Editar carpeta</span>
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onToggleFolderCollapse(folder);
                }}
                className={itemBtnClass}
              >
                <span className="flex items-center gap-2">
                  {folder.isCollapsed ? (
                    <ChevronsRight
                      className="w-3.5 h-3.5 text-slate-600 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronsLeft
                      className="w-3.5 h-3.5 text-slate-600 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span>{folder.isCollapsed ? 'Desplegar carpeta' : 'Plegar carpeta'}</span>
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onCopyFolderGrades(folder, childCols);
                }}
                className={itemBtnClass}
              >
                <span className="flex items-center gap-2">
                  <ClipboardCopy
                    className="w-3.5 h-3.5 text-slate-600 shrink-0"
                    aria-hidden="true"
                  />
                  <span>Copiar notas resumen (A–Z)</span>
                </span>
              </button>

              {editableChildColIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={emptyFolderNpCount === 0}
                  onClick={() => {
                    onClose();
                    onFillEmptyWithNP(editableChildColIds, folder.title);
                  }}
                  className={itemBtnClass}
                >
                  <span className="flex items-center gap-2">
                    <FileX2
                      className="w-3.5 h-3.5 text-indigo-600 shrink-0"
                      aria-hidden="true"
                    />
                    <span>Rellenar vacías: 0 NP ({emptyFolderNpCount})</span>
                  </span>
                </button>
              )}

              {!isTabLocked && (
                <>
                  <hr className="my-1 border-slate-100" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onClose();
                      onDeleteFolder(folder);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-rose-50 focus:bg-rose-50 focus:outline-none flex items-center gap-2 text-rose-600 font-semibold transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Deshacer carpeta</span>
                  </button>
                </>
              )}
            </div>
          </>
        );
      })()}
    </div>,
    document.body
  );
};
