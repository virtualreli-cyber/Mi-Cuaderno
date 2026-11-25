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
  remaining: ColumnEntity[];
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

  const [selectedColIds, setSelectedColIds] = useState<string[]>([]);
  const [targetClassId, setTargetClassId] = useState('');
  const [targetTabId, setTargetTabId] = useState('');
  const [targetFolderId, setTargetFolderId] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingBatch, setPendingBatch] = useState<PendingColumnBatchState | null>(null);

  const sortedSourceTabs = useMemo(
    () => (sourceBook ? [...sourceBook.tabs].sort((a, b) => a.orderIndex - b.orderIndex) : []),
    [sourceBook]
  );

  const sourceColMap = useMemo(() => {
    const map = new Map<string, ColumnEntity>();
    for (const tab of sortedSourceTabs) {
      for (const col of tab.columns) {
        map.set(col.id, col);
      }
    }
    return map;
  }, [sortedSourceTabs]);

  // Order target classes with other classes first so copying to another class is immediate
  const orderedTargetClasses = useMemo(() => {
    if (!sourceBook) return workspace.classes;
    const others = workspace.classes.filter((c) => c.id !== sourceBook.id);
    const same = workspace.classes.filter((c) => c.id === sourceBook.id);
    return [...others, ...same];
  }, [workspace.classes, sourceBook]);

  useEffect(() => {
    if (!open || !sourceBook) return;
    setFeedback(null);
    setPendingBatch(null);
    setSelectedColIds(initialColumnIds.filter((id) => sourceColMap.has(id)));
    const defaultTarget = orderedTargetClasses[0] ?? workspace.classes[0];
    setTargetClassId(defaultTarget?.id ?? '');
    setTargetTabId(defaultTarget?.tabs[0]?.id ?? '');
    setTargetFolderId('');
    // Initialize only when opening modal or changing source/initial selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceBook?.id, initialColumnIds.join(',')]);

  if (!sourceBook) return null;

  const targetClass = workspace.classes.find((c) => c.id === targetClassId) ?? null;
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
    copyColumnsToTarget(sourceBook.id, decisions, targetClass.id, targetTab.id, {
      targetFolderId: targetFolderId || null,
    });
    const replacedCount = decisions.filter((d) => d.mode === 'REPLACE').length;
    const addedCount = decisions.length - replacedCount;
    if (decisions.length === 1) {
      setFeedback(
        replacedCount === 1
          ? `Columna sustituida en «${targetClass.name}» (${targetTab.title}).`
          : `Columna copiada a «${targetClass.name}» (${targetTab.title}).`
      );
    } else if (replacedCount === 0) {
      setFeedback(`${addedCount} columnas copiadas a «${targetClass.name}» (${targetTab.title}).`);
    } else if (addedCount === 0) {
      setFeedback(
        `${replacedCount} columnas sustituidas en «${targetClass.name}» (${targetTab.title}).`
      );
    } else {
      setFeedback(
        `${addedCount} ${addedCount === 1 ? 'columna copiada' : 'columnas copiadas'} y ${replacedCount} ${
          replacedCount === 1 ? 'sustituida' : 'sustituidas'
        } en «${targetClass.name}».`
      );
    }
  };

  const processQueue = (
    queue: ColumnEntity[],
    resolved: BatchColumnDecision[],
    totalCount: number
  ) => {
    if (!targetClass || !targetTab) return;
    const nextResolved = [...resolved];

    for (let i = 0; i < queue.length; i++) {
      const col = queue[i];
      const matches = findCopyConflicts(targetClass, 'COLUMN', col.title, targetTab.id);
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

    const orderedCols: ColumnEntity[] = [];
    const wanted = new Set(selectedColIds);
    for (const tab of sortedSourceTabs) {
      const tabCols = [...tab.columns].sort((a, b) => a.orderIndex - b.orderIndex);
      for (const c of tabCols) {
        if (wanted.has(c.id)) orderedCols.push(c);
      }
    }
    for (const id of selectedColIds) {
      const col = sourceColMap.get(id);
      if (col && !orderedCols.some((c) => c.id === id)) {
        orderedCols.push(col);
      }
    }
    if (orderedCols.length === 0) return;
    processQueue(orderedCols, [], orderedCols.length);
  };

  const canSubmit = Boolean(targetClass && targetTab && selectedColIds.length > 0);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Copiar columnas a otra clase"
        subtitle={`Origen: ${sourceBook.name}`}
        maxWidthClass="w-[min(640px,95vw)]"
        notice={feedback}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-bold text-slate-800">Columnas seleccionadas para copiar</div>
                <div className="text-[11px] text-slate-500">
                  Puedes añadir o quitar más columnas de cualquier pestaña antes de copiar
                </div>
              </div>
              <div className="flex items-center gap-2">
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
              tabs={sourceBook.tabs}
              activeTabId={activeTabId}
              allowFolders={false}
              selectedIds={selectedColIds}
              onToggleId={toggleColId}
              onToggleMany={toggleManyColIds}
              ariaLabel="Columnas de la clase origen agrupadas por pestaña"
              emptyMessage="No hay columnas disponibles en este cuaderno."
              maxHeightClass="max-h-[250px]"
            />
          </div>

          {/* Target Class & Tab */}
          <div className="space-y-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Clase destino</label>
              <select
                value={targetClassId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setTargetClassId(nextId);
                  const cls = workspace.classes.find((c) => c.id === nextId);
                  setTargetTabId(cls?.tabs[0]?.id ?? '');
                  setTargetFolderId('');
                }}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
              >
                {orderedTargetClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.subject}
                    {c.id === sourceBook.id ? ' (clase actual)' : ''}
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
                    }}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                  >
                    {targetClass.tabs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
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
                      onChange={(e) => setTargetFolderId(e.target.value)}
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
              Se copia la estructura de las columnas (título, tipo, escala, rúbrica, criterios LOMLOE y
              fórmulas internas entre ellas) sin notas de alumnos.
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
