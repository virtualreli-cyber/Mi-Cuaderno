import React, { useEffect, useMemo, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { findCopyConflicts } from '../../engine/copyConflictEngine';
import type { ClassBook, ColumnEntity } from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { TabColumnPicker } from '../common/TabColumnPicker';
import { CopyConflictModal, type PendingCopyConflict } from './CopyConflictModal';

interface CopyColumnsModalProps {
  open: boolean;
  onClose: () => void;
  sourceBook: ClassBook | null;
  activeTabId?: string | null;
  initialColumnIds: string[];
}

interface BatchColumnDecision {
  columnId: string;
  mode: 'ADD' | 'REPLACE';
  replaceColumnId?: string;
}

interface PendingColumnBatchState {
  remaining: Array<{ col: ColumnEntity; sourceTabId: string }>;
  resolved: BatchColumnDecision[];
  totalCount: number;
  currentCol: ColumnEntity;
  conflict: PendingCopyConflict;
}

export const CopyColumnsModal: React.FC<CopyColumnsModalProps> = ({
  open,
  onClose,
  sourceBook,
  activeTabId = null,
  initialColumnIds,
}) => {
  const { workspace, copyColumnsToTarget } = useGradebook();

  const [selectedSourceBookId, setSelectedSourceBookId] = useState('');
  const [selectedColIds, setSelectedColIds] = useState<string[]>([]);
  const [targetClassId, setTargetClassId] = useState('');
  const [targetTabId, setTargetTabId] = useState('');
  const [targetFolderId, setTargetFolderId] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingBatch, setPendingBatch] = useState<PendingColumnBatchState | null>(null);

  const allSourceBooks = useMemo(() => {
    const list: ClassBook[] = [...workspace.classes, ...workspace.templates];
    if (sourceBook && !list.some((b) => b.id === sourceBook.id)) {
      list.unshift(sourceBook);
    }
    return list;
  }, [workspace.classes, workspace.templates, sourceBook]);

  const effectiveSourceBook = useMemo(
    () =>
      allSourceBooks.find((b) => b.id === selectedSourceBookId) ??
      sourceBook ??
      workspace.classes[0] ??
      null,
    [allSourceBooks, selectedSourceBookId, sourceBook, workspace.classes]
  );

  const sortedSourceTabs = useMemo(
    () =>
      effectiveSourceBook
        ? [...effectiveSourceBook.tabs].sort((a, b) => a.orderIndex - b.orderIndex)
        : [],
    [effectiveSourceBook]
  );

  const sourceColMap = useMemo(() => {
    const map = new Map<string, { col: ColumnEntity; tabId: string }>();
    for (const tab of sortedSourceTabs) {
      for (const col of tab.columns) {
        map.set(col.id, { col, tabId: tab.id });
      }
    }
    return map;
  }, [sortedSourceTabs]);

  // All valid target books: current book first (so same-class / cross-tab / same-tab copy is 1 click),
  // followed by all other classes (and templates if copying from a template)
  const orderedTargetBooks = useMemo(() => {
    const list: ClassBook[] = [...workspace.classes];
    if (effectiveSourceBook?.isTemplate && !list.some((b) => b.id === effectiveSourceBook.id)) {
      list.push(effectiveSourceBook);
    }
    if (!effectiveSourceBook) return list;
    const current = list.filter((b) => b.id === effectiveSourceBook.id);
    const others = list.filter((b) => b.id !== effectiveSourceBook.id);
    return [...current, ...others];
  }, [workspace.classes, effectiveSourceBook]);

  useEffect(() => {
    if (!open || !sourceBook) return;
    setFeedback(null);
    setPendingBatch(null);
    setSelectedSourceBookId(sourceBook.id);

    const validIds = new Set(sourceBook.tabs.flatMap((t) => t.columns.map((c) => c.id)));
    setSelectedColIds(initialColumnIds.filter((id) => validIds.has(id)));

    // Default target: if user opened from a class and has other classes, keep current class easily selectable,
    // or default to current class if there is only 1 class / or another tab exists.
    // Let's default to current class when only 1 class, or other class when multiple classes?
    // Even better: default to current class (with activeTabId) so user immediately sees all options,
    // OR if sourceBook is a template, default to first class.
    const defaultTarget =
      sourceBook.isTemplate
        ? (workspace.classes[0] ?? sourceBook)
        : sourceBook;
    setTargetClassId(defaultTarget.id);
    setTargetTabId(
      defaultTarget.id === sourceBook.id
        ? (activeTabId ?? defaultTarget.tabs[0]?.id ?? '')
        : (defaultTarget.tabs[0]?.id ?? '')
    );
    setTargetFolderId('');
    // Initialize only when opening modal or changing source/initial selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceBook?.id, initialColumnIds.join(',')]);

  if (!effectiveSourceBook) return null;

  const targetClass =
    orderedTargetBooks.find((c) => c.id === targetClassId) ??
    workspace.classes.find((c) => c.id === targetClassId) ??
    null;
  const targetTab = targetClass?.tabs.find((t) => t.id === targetTabId) ?? null;

  const toggleColId = (colId: string) => {
    setFeedback(null);
    setSelectedColIds((prev) =>
      prev.includes(colId) ? prev.filter((id) => id !== colId) : [...prev, colId]
    );
  };

  const toggleManyColIds = (ids: string[], select: boolean) => {
    setFeedback(null);
    setSelectedColIds((prev) => {
      if (!select) {
        const removeSet = new Set(ids);
        return prev.filter((id) => !removeSet.has(id));
      }
      const next = [...prev];
      for (const id of ids) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
  };

  const commitBatch = (decisions: BatchColumnDecision[]) => {
    if (!targetClass || !targetTab || decisions.length === 0) return;
    copyColumnsToTarget(effectiveSourceBook.id, decisions, targetClass.id, targetTab.id, {
      targetFolderId: targetFolderId || null,
    });
    const replacedCount = decisions.filter((d) => d.mode === 'REPLACE').length;
    const addedCount = decisions.length - replacedCount;
    const targetFolderTitle = targetFolderId
      ? targetTab.folders.find((f) => f.id === targetFolderId)?.title
      : null;
    const destLabel = targetFolderTitle
      ? `«${targetClass.name}» (${targetTab.title} · ${targetFolderTitle})`
      : `«${targetClass.name}» (${targetTab.title})`;

    if (decisions.length === 1) {
      setFeedback(
        replacedCount === 1
          ? `Columna sustituida en ${destLabel}.`
          : `Columna copiada a ${destLabel}.`
      );
    } else if (replacedCount === 0) {
      setFeedback(`${addedCount} columnas copiadas a ${destLabel}.`);
    } else if (addedCount === 0) {
      setFeedback(`${replacedCount} columnas sustituidas en ${destLabel}.`);
    } else {
      setFeedback(
        `${addedCount} ${addedCount === 1 ? 'columna copiada' : 'columnas copiadas'} y ${replacedCount} ${
          replacedCount === 1 ? 'sustituida' : 'sustituidas'
        } en ${destLabel}.`
      );
    }
  };

  const processQueue = (
    queue: Array<{ col: ColumnEntity; sourceTabId: string }>,
    resolved: BatchColumnDecision[],
    totalCount: number
  ) => {
    if (!targetClass || !targetTab) return;
    const nextResolved = [...resolved];

    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      const { col, sourceTabId } = entry;
      const isSameTabInSameBook =
        targetClass.id === effectiveSourceBook.id && targetTab.id === sourceTabId;
      const matches = findCopyConflicts(
        targetClass,
        'COLUMN',
        col.title,
        targetTab.id,
        isSameTabInSameBook ? col.id : undefined
      );
      if (matches.length > 0) {
        const positionPrefix =
          totalCount > 1 ? `(${nextResolved.length + 1} de ${totalCount}) ` : '';
        setPendingBatch({
          remaining: queue.slice(i + 1),
          resolved: nextResolved,
          totalCount,
          currentCol: col,
          conflict: {
            kind: 'COLUMN',
            sourceTitle: `${positionPrefix}${col.title}`,
            targetClassName: targetClass.name,
            targetTabTitle: targetTab.title,
            matches,
          },
        });
        return;
      }
      nextResolved.push({ columnId: col.id, mode: 'ADD' });
    }

    setPendingBatch(null);
    commitBatch(nextResolved);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!targetClass || !targetTab || selectedColIds.length === 0) return;

    const orderedCols: Array<{ col: ColumnEntity; sourceTabId: string }> = [];
    const wanted = new Set(selectedColIds);
    for (const tab of sortedSourceTabs) {
      const tabCols = [...tab.columns].sort((a, b) => a.orderIndex - b.orderIndex);
      for (const c of tabCols) {
        if (wanted.has(c.id)) orderedCols.push({ col: c, sourceTabId: tab.id });
      }
    }
    for (const id of selectedColIds) {
      const found = sourceColMap.get(id);
      if (found && !orderedCols.some((entry) => entry.col.id === id)) {
        orderedCols.push({ col: found.col, sourceTabId: found.tabId });
      }
    }
    if (orderedCols.length === 0) return;
    processQueue(orderedCols, [], orderedCols.length);
  };

  const canSubmit = Boolean(targetClass && targetTab && selectedColIds.length > 0);
  const pickerActiveTabId =
    effectiveSourceBook.id === sourceBook?.id
      ? activeTabId
      : (sortedSourceTabs[0]?.id ?? null);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Copiar columnas"
        subtitle="Copia una o varias columnas dentro de la misma clase, entre pestañas o desde/hacia otra clase"
        maxWidthClass="w-[min(660px,95vw)]"
        notice={feedback}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex-1 min-w-[200px]">
                <label className="block font-bold text-slate-800 mb-1">
                  Origen de las columnas
                </label>
                <select
                  aria-label="Clase o plantilla origen"
                  value={effectiveSourceBook.id}
                  onChange={(e) => {
                    const nextSourceId = e.target.value;
                    setSelectedSourceBookId(nextSourceId);
                    setSelectedColIds([]);
                    setFeedback(null);
                  }}
                  className="w-full border border-slate-300 rounded-xl px-2.5 py-1.5 bg-white font-semibold text-slate-800"
                >
                  {workspace.classes.length > 0 && (
                    <optgroup label="Clases">
                      {workspace.classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} — {c.subject}
                          {c.id === sourceBook?.id ? ' (actual)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {workspace.templates.length > 0 && (
                    <optgroup label="Plantillas">
                      {workspace.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} — {t.subject}
                          {t.id === sourceBook?.id ? ' (actual)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div className="flex items-center gap-2 self-end pb-1">
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${
                    selectedColIds.length > 0
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200/80 text-slate-600'
                  }`}
                >
                  {selectedColIds.length}{' '}
                  {selectedColIds.length === 1 ? 'seleccionada' : 'seleccionadas'}
                </span>
                {selectedColIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedColIds([])}
                    className="text-[11px] font-semibold text-slate-500 hover:text-rose-600"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            <TabColumnPicker
              tabs={effectiveSourceBook.tabs}
              activeTabId={pickerActiveTabId}
              allowFolders={false}
              selectedIds={selectedColIds}
              onToggleId={toggleColId}
              onToggleMany={toggleManyColIds}
              ariaLabel="Columnas del cuaderno origen agrupadas por pestaña"
              emptyMessage="No hay columnas disponibles en este cuaderno."
              maxHeightClass="max-h-[240px]"
            />
          </div>

          {/* Target Class, Tab & Folder */}
          <div className="space-y-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Clase destino</label>
              <select
                value={targetClassId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setTargetClassId(nextId);
                  const cls = orderedTargetBooks.find((c) => c.id === nextId);
                  setTargetTabId(
                    cls?.id === sourceBook?.id && activeTabId
                      ? activeTabId
                      : (cls?.tabs[0]?.id ?? '')
                  );
                  setTargetFolderId('');
                  setFeedback(null);
                }}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
              >
                {orderedTargetBooks.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.subject}
                    {c.id === sourceBook?.id
                      ? c.isTemplate
                        ? ' (plantilla actual)'
                        : ' (clase actual)'
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            {targetClass && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pestaña destino</label>
                  <select
                    value={targetTabId}
                    onChange={(e) => {
                      setTargetTabId(e.target.value);
                      setTargetFolderId('');
                      setFeedback(null);
                    }}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                  >
                    {targetClass.tabs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {targetClass.id === sourceBook?.id && t.id === activeTabId
                          ? ' (pestaña actual)'
                          : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {targetTab && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Carpeta destino (opcional)
                    </label>
                    <select
                      value={targetFolderId}
                      onChange={(e) => {
                        setTargetFolderId(e.target.value);
                        setFeedback(null);
                      }}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                    >
                      <option value="">Sin carpeta (suelta)</option>
                      {targetTab.folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2">
              Puedes copiar dentro de la misma pestaña, a otra pestaña de la clase o a cualquier otra
              clase (eligiendo pestaña y carpeta). Se copia la estructura sin notas de alumnos.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
            >
              Cerrar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5"
            >
              {selectedColIds.length > 1 ? (
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>
                {selectedColIds.length > 1
                  ? `Copiar ${selectedColIds.length} columnas`
                  : 'Copiar columna'}
              </span>
            </button>
          </div>
        </form>
      </Modal>

      <CopyConflictModal
        conflict={pendingBatch?.conflict ?? null}
        onCancel={() => setPendingBatch(null)}
        onAddBoth={() => {
          if (!pendingBatch) return;
          const nextResolved: BatchColumnDecision[] = [
            ...pendingBatch.resolved,
            { columnId: pendingBatch.currentCol.id, mode: 'ADD' },
          ];
          processQueue(pendingBatch.remaining, nextResolved, pendingBatch.totalCount);
        }}
        onReplace={(existingId) => {
          if (!pendingBatch) return;
          const nextResolved: BatchColumnDecision[] = [
            ...pendingBatch.resolved,
            {
              columnId: pendingBatch.currentCol.id,
              mode: 'REPLACE',
              replaceColumnId: existingId,
            },
          ];
          processQueue(pendingBatch.remaining, nextResolved, pendingBatch.totalCount);
        }}
      />
    </>
  );
};
