import React, { useEffect, useMemo, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { findCopyConflicts } from '../../engine/copyConflictEngine';
import type { ClassBook, ColumnEntity } from '../../types/gradebook';
import { Modal } from '../common/Modal';
import {
  MultiClassTargetPicker,
  resolveDefaultTabIdForBook,
  type TargetClassSelection,
} from '../common/MultiClassTargetPicker';
import { TabColumnPicker } from '../common/TabColumnPicker';
import { CopyConflictModal, type PendingCopyConflict } from './CopyConflictModal';

interface CopyColumnsModalProps {
  open: boolean;
  onClose: () => void;
  sourceBook: ClassBook | null;
  activeTabId?: string | null;
  initialColumnIds: string[];
}

interface TargetQueueItem {
  targetBook: ClassBook;
  targetTabId: string;
  targetTabTitle: string;
  targetFolderId: string | null;
  col: ColumnEntity;
  sourceTabId: string;
}

interface ResolvedDecision {
  targetClassId: string;
  targetTabId: string;
  targetFolderId: string | null;
  columnId: string;
  mode: 'ADD' | 'REPLACE';
  replaceColumnId?: string;
}

interface PendingMultiBatchState {
  remaining: TargetQueueItem[];
  resolved: ResolvedDecision[];
  totalCount: number;
  currentItem: TargetQueueItem;
  conflict: PendingCopyConflict;
}

export const CopyColumnsModal: React.FC<CopyColumnsModalProps> = ({
  open,
  onClose,
  sourceBook,
  activeTabId = null,
  initialColumnIds,
}) => {
  const { workspace, copyColumnsToTargets } = useGradebook();

  const [selectedSourceBookId, setSelectedSourceBookId] = useState('');
  const [selectedColIds, setSelectedColIds] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<Record<string, TargetClassSelection>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingBatch, setPendingBatch] = useState<PendingMultiBatchState | null>(null);

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
    const map = new Map<string, { col: ColumnEntity; tabId: string; tabTitle: string }>();
    for (const tab of sortedSourceTabs) {
      for (const col of tab.columns) {
        map.set(col.id, { col, tabId: tab.id, tabTitle: tab.title });
      }
    }
    return map;
  }, [sortedSourceTabs]);

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

  const preferredTabTitle = useMemo(() => {
    const firstSel = selectedColIds[0] ? sourceColMap.get(selectedColIds[0]) : null;
    if (firstSel) return firstSel.tabTitle;
    if (sourceBook && activeTabId) {
      return sourceBook.tabs.find((t) => t.id === activeTabId)?.title ?? null;
    }
    return sortedSourceTabs[0]?.title ?? null;
  }, [selectedColIds, sourceColMap, sourceBook, activeTabId, sortedSourceTabs]);

  useEffect(() => {
    if (!open || !sourceBook) return;
    setFeedback(null);
    setPendingBatch(null);
    setSelectedSourceBookId(sourceBook.id);

    const validIds = new Set(sourceBook.tabs.flatMap((t) => t.columns.map((c) => c.id)));
    setSelectedColIds(initialColumnIds.filter((id) => validIds.has(id)));

    const activeTabTitle =
      sourceBook.tabs.find((t) => t.id === activeTabId)?.title ?? sourceBook.tabs[0]?.title ?? null;
    const defaultTarget = sourceBook.isTemplate
      ? (workspace.classes[0] ?? sourceBook)
      : sourceBook;

    setSelectedTargets({
      [defaultTarget.id]: {
        tabId: resolveDefaultTabIdForBook(defaultTarget, sourceBook.id, activeTabId, activeTabTitle),
        folderId: '',
      },
    });
    // Initialize only when opening modal or changing source/initial selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceBook?.id, initialColumnIds.join(',')]);

  if (!effectiveSourceBook) return null;

  const chosenTargetsList = orderedTargetBooks
    .filter((b) => Boolean(selectedTargets[b.id]))
    .map((book) => {
      const sel = selectedTargets[book.id]!;
      const tab = book.tabs.find((t) => t.id === sel.tabId) ?? book.tabs[0];
      return tab ? { book, tab, folderId: sel.folderId || null } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

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

  const commitResolved = (decisions: ResolvedDecision[]) => {
    if (decisions.length === 0) return;

    const grouped = new Map<
      string,
      {
        targetClassId: string;
        targetTabId: string;
        targetFolderId: string | null;
        items: Array<{
          columnId: string;
          mode: 'ADD' | 'REPLACE';
          replaceColumnId?: string;
        }>;
      }
    >();

    for (const d of decisions) {
      const key = `${d.targetClassId}::${d.targetTabId}::${d.targetFolderId ?? ''}`;
      const entry = grouped.get(key) ?? {
        targetClassId: d.targetClassId,
        targetTabId: d.targetTabId,
        targetFolderId: d.targetFolderId,
        items: [],
      };
      entry.items.push({
        columnId: d.columnId,
        mode: d.mode,
        replaceColumnId: d.replaceColumnId,
      });
      grouped.set(key, entry);
    }

    copyColumnsToTargets(effectiveSourceBook.id, Array.from(grouped.values()));

    const uniqueClassIds = new Set(decisions.map((d) => d.targetClassId));
    const uniqueColIds = new Set(decisions.map((d) => d.columnId));
    const replacedCount = decisions.filter((d) => d.mode === 'REPLACE').length;

    if (uniqueClassIds.size === 1) {
      const onlyBook = orderedTargetBooks.find((b) => uniqueClassIds.has(b.id));
      const onlyTab = onlyBook?.tabs.find((t) => t.id === decisions[0].targetTabId);
      const destLabel = onlyBook
        ? `«${onlyBook.name}»${onlyTab ? ` (${onlyTab.title})` : ''}`
        : 'la clase destino';
      if (decisions.length === 1) {
        setFeedback(
          replacedCount === 1
            ? `Columna sustituida en ${destLabel}.`
            : `Columna copiada a ${destLabel}.`
        );
      } else {
        setFeedback(`${decisions.length} columnas copiadas a ${destLabel}.`);
      }
    } else {
      setFeedback(
        `${uniqueColIds.size} ${uniqueColIds.size === 1 ? 'columna copiada' : 'columnas copiadas'} en ${uniqueClassIds.size} clases a la vez.`
      );
    }
  };

  const processQueue = (
    queue: TargetQueueItem[],
    resolved: ResolvedDecision[],
    totalCount: number
  ) => {
    const nextResolved = [...resolved];

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      const isSameTabInSameBook =
        item.targetBook.id === effectiveSourceBook.id && item.targetTabId === item.sourceTabId;
      const matches = findCopyConflicts(
        item.targetBook,
        'COLUMN',
        item.col.title,
        item.targetTabId,
        isSameTabInSameBook ? item.col.id : undefined
      );
      if (matches.length > 0) {
        const prefix =
          totalCount > 1 ? `(${nextResolved.length + 1} de ${totalCount}) ` : '';
        setPendingBatch({
          remaining: queue.slice(i + 1),
          resolved: nextResolved,
          totalCount,
          currentItem: item,
          conflict: {
            kind: 'COLUMN',
            sourceTitle: `${prefix}${item.col.title}`,
            targetClassName: item.targetBook.name,
            targetTabTitle: item.targetTabTitle,
            matches,
          },
        });
        return;
      }

      nextResolved.push({
        targetClassId: item.targetBook.id,
        targetTabId: item.targetTabId,
        targetFolderId: item.targetFolderId,
        columnId: item.col.id,
        mode: 'ADD',
      });
    }

    setPendingBatch(null);
    commitResolved(nextResolved);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (chosenTargetsList.length === 0 || selectedColIds.length === 0) return;

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

    const queue: TargetQueueItem[] = [];
    for (const target of chosenTargetsList) {
      for (const entry of orderedCols) {
        queue.push({
          targetBook: target.book,
          targetTabId: target.tab.id,
          targetTabTitle: target.tab.title,
          targetFolderId: target.folderId,
          col: entry.col,
          sourceTabId: entry.sourceTabId,
        });
      }
    }

    processQueue(queue, [], queue.length);
  };

  const canSubmit = chosenTargetsList.length > 0 && selectedColIds.length > 0;
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
        subtitle="Copia una o varias columnas a la misma clase o a varias clases a la vez, eligiendo pestaña y carpeta en cada una"
        maxWidthClass="w-[min(700px,95vw)]"
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
              maxHeightClass="max-h-[210px]"
            />
          </div>

          <MultiClassTargetPicker
            books={orderedTargetBooks}
            currentBookId={sourceBook?.id ?? null}
            activeTabId={activeTabId}
            preferredTabTitle={preferredTabTitle}
            selectedTargets={selectedTargets}
            onChangeTargets={(next) => {
              setSelectedTargets(next);
              setFeedback(null);
            }}
          />

          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2">
            Se copia la estructura de las columnas (título, escala, rúbrica, criterios LOMLOE y
            fórmulas internas) sin notas de alumnos. Si hay conflicto de nombres, se te preguntará en
            cada caso.
          </p>

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
              {selectedColIds.length > 1 || chosenTargetsList.length > 1 ? (
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>
                {chosenTargetsList.length > 1
                  ? `Copiar ${selectedColIds.length > 1 ? `${selectedColIds.length} cols.` : 'columna'} a ${chosenTargetsList.length} clases`
                  : selectedColIds.length > 1
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
          const item = pendingBatch.currentItem;
          const nextResolved: ResolvedDecision[] = [
            ...pendingBatch.resolved,
            {
              targetClassId: item.targetBook.id,
              targetTabId: item.targetTabId,
              targetFolderId: item.targetFolderId,
              columnId: item.col.id,
              mode: 'ADD',
            },
          ];
          processQueue(pendingBatch.remaining, nextResolved, pendingBatch.totalCount);
        }}
        onReplace={(existingId) => {
          if (!pendingBatch) return;
          const item = pendingBatch.currentItem;
          const nextResolved: ResolvedDecision[] = [
            ...pendingBatch.resolved,
            {
              targetClassId: item.targetBook.id,
              targetTabId: item.targetTabId,
              targetFolderId: item.targetFolderId,
              columnId: item.col.id,
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
