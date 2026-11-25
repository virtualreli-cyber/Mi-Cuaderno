import React, { useEffect, useMemo, useState } from 'react';
import { Check, Columns, Folder, FolderPlus, Layers } from 'lucide-react';
import { blendWithWhite } from '../../constants/colors';
import { useGradebook } from '../../context/GradebookContext';
import { findCopyConflicts } from '../../engine/copyConflictEngine';
import type { ClassBook, ColumnEntity } from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { TabColumnPicker } from '../common/TabColumnPicker';
import { CopyConflictModal, type PendingCopyConflict } from './CopyConflictModal';

interface TemplateApplyModalProps {
  open: boolean;
  onClose: () => void;
  template: ClassBook | null;
}

type CopyMode = 'COPY_COLUMN' | 'COPY_FOLDER' | 'COPY_TAB' | 'NEW_CLASS';

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

export const TemplateApplyModal: React.FC<TemplateApplyModalProps> = ({
  open,
  onClose,
  template,
}) => {
  const {
    workspace,
    instantiateTemplateAsClass,
    copyColumnsToTarget,
    copyFolderToTarget,
    copyTabToTarget,
  } = useGradebook();

  const [mode, setMode] = useState<CopyMode>('COPY_COLUMN');
  const [newClassName, setNewClassName] = useState('');
  const [newClassSubject, setNewClassSubject] = useState('');
  const [targetClassId, setTargetClassId] = useState('');
  const [targetTabId, setTargetTabId] = useState('');
  const [targetFolderId, setTargetFolderId] = useState('');

  const [selectedColIds, setSelectedColIds] = useState<string[]>([]);
  const [selectedFolderKey, setSelectedFolderKey] = useState(''); // `${tabId}::${folderId}`
  const [selectedSourceTabId, setSelectedSourceTabId] = useState('');

  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingCopyConflict | null>(null);
  const [pendingColBatch, setPendingColBatch] = useState<PendingColumnBatchState | null>(null);

  const templateColMap = useMemo(() => {
    const map = new Map<string, ColumnEntity>();
    if (!template) return map;
    for (const t of template.tabs) {
      for (const c of t.columns) {
        map.set(c.id, c);
      }
    }
    return map;
  }, [template]);

  const templateFoldersByTab = useMemo(() => {
    if (!template) return [];
    return [...template.tabs]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((t) => ({
        tab: t,
        folders: [...t.folders]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((f) => ({
            key: `${t.id}::${f.id}`,
            tabId: t.id,
            tabTitle: t.title,
            folder: f,
            colCount: t.columns.filter((c) => c.folderId === f.id).length,
          })),
      }))
      .filter((group) => group.folders.length > 0);
  }, [template]);

  const templateFolders = useMemo(
    () => templateFoldersByTab.flatMap((g) => g.folders),
    [templateFoldersByTab]
  );

  const sortedTemplateTabs = useMemo(
    () => (template ? [...template.tabs].sort((a, b) => a.orderIndex - b.orderIndex) : []),
    [template]
  );

  useEffect(() => {
    if (!open || !template) return;
    setFeedback(null);
    setPendingConflict(null);
    setPendingColBatch(null);
    setNewClassName(`Nueva clase (${template.name})`);
    setNewClassSubject(template.subject);
    const firstCls = workspace.classes[0];
    setTargetClassId(firstCls?.id ?? '');
    setTargetTabId(firstCls?.tabs[0]?.id ?? '');
    setTargetFolderId('');
    setSelectedColIds([]);
    setSelectedFolderKey(templateFolders[0]?.key ?? '');
    setSelectedSourceTabId(sortedTemplateTabs[0]?.id ?? '');
    // Only reset when modal opens or switches to a different template
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  if (!template) return null;

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

  const commitColumnBatch = (decisions: BatchColumnDecision[]) => {
    if (!targetClass || !targetTab || decisions.length === 0) return;
    copyColumnsToTarget(template.id, decisions, targetClass.id, targetTab.id, {
      targetFolderId: targetFolderId || null,
    });
    const replacedCount = decisions.filter((d) => d.mode === 'REPLACE').length;
    const addedCount = decisions.length - replacedCount;
    if (decisions.length === 1) {
      setFeedback(
        replacedCount === 1
          ? `Columna sustituida en «${targetClass.name}».`
          : `Columna copiada a «${targetClass.name}».`
      );
    } else if (replacedCount === 0) {
      setFeedback(`${addedCount} columnas copiadas a «${targetClass.name}».`);
    } else if (addedCount === 0) {
      setFeedback(`${replacedCount} columnas sustituidas en «${targetClass.name}».`);
    } else {
      setFeedback(
        `${addedCount} ${addedCount === 1 ? 'columna copiada' : 'columnas copiadas'} y ${replacedCount} ${
          replacedCount === 1 ? 'sustituida' : 'sustituidas'
        } en «${targetClass.name}».`
      );
    }
  };

  const processColumnQueue = (
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
        setPendingColBatch({
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

    setPendingColBatch(null);
    commitColumnBatch(nextResolved);
  };

  const executeSingleCopy = (resolution: 'ADD' | 'REPLACE', replaceId?: string) => {
    if (!targetClass) return;

    if (mode === 'COPY_FOLDER') {
      const [srcTabId, srcFldId] = selectedFolderKey.split('::');
      if (!srcTabId || !srcFldId || !targetTabId) return;
      copyFolderToTarget(template.id, srcTabId, srcFldId, targetClass.id, targetTabId, {
        mode: resolution,
        replaceFolderId: replaceId,
      });
      setFeedback(
        resolution === 'REPLACE'
          ? `Carpeta sustituida en «${targetClass.name}».`
          : `Carpeta copiada a «${targetClass.name}».`
      );
    } else if (mode === 'COPY_TAB') {
      if (!selectedSourceTabId) return;
      copyTabToTarget(template.id, selectedSourceTabId, targetClass.id, {
        mode: resolution,
        replaceTabId: replaceId,
      });
      setFeedback(
        resolution === 'REPLACE'
          ? `Pestaña sustituida en «${targetClass.name}».`
          : `Pestaña copiada a «${targetClass.name}».`
      );
    }
    setPendingConflict(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (mode === 'NEW_CLASS') {
      instantiateTemplateAsClass(template.id, newClassName, newClassSubject, template.color);
      onClose();
      return;
    }

    if (!targetClass) return;

    if (mode === 'COPY_COLUMN') {
      if (!targetTab || selectedColIds.length === 0) return;
      // Preserve source tab & column visual ordering
      const orderedSelectedCols: ColumnEntity[] = [];
      const wanted = new Set(selectedColIds);
      for (const tab of sortedTemplateTabs) {
        const tabCols = [...tab.columns].sort((a, b) => a.orderIndex - b.orderIndex);
        for (const c of tabCols) {
          if (wanted.has(c.id)) orderedSelectedCols.push(c);
        }
      }
      // Fallback for any ID not yet pushed
      for (const id of selectedColIds) {
        const col = templateColMap.get(id);
        if (col && !orderedSelectedCols.some((c) => c.id === id)) {
          orderedSelectedCols.push(col);
        }
      }
      if (orderedSelectedCols.length === 0) return;
      processColumnQueue(orderedSelectedCols, [], orderedSelectedCols.length);
    } else if (mode === 'COPY_FOLDER') {
      const src = templateFolders.find((x) => x.key === selectedFolderKey);
      if (!src || !targetTab) return;
      const matches = findCopyConflicts(targetClass, 'FOLDER', src.folder.title, targetTab.id);
      if (matches.length > 0) {
        setPendingConflict({
          kind: 'FOLDER',
          sourceTitle: src.folder.title,
          targetClassName: targetClass.name,
          targetTabTitle: targetTab.title,
          matches,
        });
        return;
      }
      executeSingleCopy('ADD');
    } else if (mode === 'COPY_TAB') {
      const srcTab = template.tabs.find((t) => t.id === selectedSourceTabId);
      if (!srcTab) return;
      const matches = findCopyConflicts(targetClass, 'TAB', srcTab.title);
      if (matches.length > 0) {
        setPendingConflict({
          kind: 'TAB',
          sourceTitle: srcTab.title,
          targetClassName: targetClass.name,
          matches,
        });
        return;
      }
      executeSingleCopy('ADD');
    }
  };

  const canSubmit =
    mode === 'NEW_CLASS'
      ? Boolean(newClassName.trim())
      : mode === 'COPY_COLUMN'
        ? Boolean(targetClass && targetTab && selectedColIds.length > 0)
        : mode === 'COPY_FOLDER'
          ? Boolean(targetClass && targetTab && selectedFolderKey)
          : Boolean(targetClass && selectedSourceTabId);

  const activeConflict = pendingColBatch ? pendingColBatch.conflict : pendingConflict;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Plantilla de clase: ${template.name}`}
        subtitle="Copia una o varias columnas, carpetas o pestañas a tus clases, o crea una clase nueva"
        maxWidthClass="w-[min(660px,95vw)]"
        notice={feedback}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(
              [
                { v: 'COPY_COLUMN', label: 'Columnas / Tareas', icon: Columns },
                { v: 'COPY_FOLDER', label: 'Carpeta', icon: Folder },
                { v: 'COPY_TAB', label: 'Pestaña', icon: Layers },
                { v: 'NEW_CLASS', label: 'Nueva clase', icon: FolderPlus },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => {
                    setMode(opt.v);
                    setFeedback(null);
                  }}
                  className={`p-2.5 rounded-xl border font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    mode === opt.v
                      ? 'border-blue-500 bg-blue-50 text-blue-900 shadow-2xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>

          {mode === 'NEW_CLASS' ? (
            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nombre de la clase nueva
                </label>
                <input
                  type="text"
                  required
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Asignatura</label>
                <input
                  type="text"
                  value={newClassSubject}
                  onChange={(e) => setNewClassSubject(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* Source selector */}
              {mode === 'COPY_COLUMN' && (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-800">
                        Selecciona una o varias columnas de la plantilla
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Organizadas por pestañas desplegables y carpetas
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
                    tabs={template.tabs}
                    allowFolders={false}
                    selectedIds={selectedColIds}
                    onToggleId={toggleColId}
                    onToggleMany={toggleManyColIds}
                    ariaLabel="Columnas disponibles en la plantilla agrupadas por pestaña"
                    emptyMessage="Esta plantilla no tiene columnas todavía."
                    maxHeightClass="max-h-[250px]"
                  />
                </div>
              )}

              {mode === 'COPY_FOLDER' && (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                  <div className="font-bold text-slate-800">
                    Carpeta de la plantilla (incluye sus columnas)
                  </div>
                  {templateFolders.length === 0 ? (
                    <p className="text-slate-500 italic">
                      Esta plantilla no tiene carpetas. Crea una carpeta dentro de la plantilla primero.
                    </p>
                  ) : (
                    <div className="max-h-56 overflow-y-auto space-y-2.5 pr-0.5">
                      {templateFoldersByTab.map(({ tab, folders }) => (
                        <div key={tab.id} className="space-y-1.5">
                          <div className="flex items-center gap-1.5 px-1">
                            <span
                              aria-hidden="true"
                              className="color-swatch-essential w-2 h-2 rounded-full border border-black/15"
                              style={{ backgroundColor: tab.color }}
                            />
                            <span className="text-[11px] font-bold text-slate-600">{tab.title}</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {folders.map((item) => {
                              const isSel = selectedFolderKey === item.key;
                              return (
                                <button
                                  key={item.key}
                                  type="button"
                                  onClick={() => setSelectedFolderKey(item.key)}
                                  style={{
                                    backgroundColor: isSel
                                      ? '#EFF6FF'
                                      : blendWithWhite(item.folder.color, 0.72),
                                  }}
                                  className={`p-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-all ${
                                    isSel
                                      ? 'border-blue-500 ring-1 ring-blue-300 shadow-2xs'
                                      : 'border-slate-200 hover:border-slate-300'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <Folder className="w-3.5 h-3.5 text-slate-700 shrink-0" aria-hidden="true" />
                                    <span className="font-bold text-slate-900 truncate">
                                      {item.folder.title}
                                    </span>
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded-full bg-white/85 border border-black/10 text-[10px] font-bold text-slate-600 tabular-nums shrink-0">
                                    {item.colCount} cols.
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {mode === 'COPY_TAB' && (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                  <div className="font-bold text-slate-800">Pestaña de la plantilla</div>
                  <div className="max-h-52 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-0.5">
                    {sortedTemplateTabs.map((t) => {
                      const isSel = selectedSourceTabId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedSourceTabId(t.id)}
                          style={{
                            backgroundColor: isSel ? '#EFF6FF' : blendWithWhite(t.color, 0.72),
                          }}
                          className={`p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-all ${
                            isSel
                              ? 'border-blue-500 ring-1 ring-blue-300 shadow-2xs'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              aria-hidden="true"
                              className="color-swatch-essential w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                              style={{ backgroundColor: t.color }}
                            />
                            <span className="font-bold text-slate-900 truncate">{t.title}</span>
                          </span>
                          <span className="px-1.5 py-0.5 rounded-full bg-white/85 border border-black/10 text-[10px] font-semibold text-slate-600 tabular-nums shrink-0">
                            {t.columns.length} cols. · {t.folders.length} carp.
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Target Class */}
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
                  {workspace.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.subject}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Tab (for column & folder copy) */}
              {(mode === 'COPY_COLUMN' || mode === 'COPY_FOLDER') && targetClass && (
                <div className={mode === 'COPY_COLUMN' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
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

                  {mode === 'COPY_COLUMN' && targetTab && (
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
                Si en la clase destino ya existe un elemento con el mismo nombre o similar, se mostrará
                un aviso para cancelar, añadir ambos o sustituirlo.
              </p>
            </div>
          )}

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
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {mode === 'NEW_CLASS'
                  ? 'Crear clase'
                  : mode === 'COPY_TAB'
                    ? 'Copiar pestaña'
                    : mode === 'COPY_FOLDER'
                      ? 'Copiar carpeta'
                      : selectedColIds.length > 1
                        ? `Copiar ${selectedColIds.length} columnas`
                        : 'Copiar columna'}
              </span>
            </button>
          </div>
        </form>
      </Modal>

      <CopyConflictModal
        conflict={activeConflict}
        onCancel={() => {
          setPendingConflict(null);
          setPendingColBatch(null);
        }}
        onAddBoth={() => {
          if (pendingColBatch) {
            const nextResolved: BatchColumnDecision[] = [
              ...pendingColBatch.resolved,
              { columnId: pendingColBatch.currentCol.id, mode: 'ADD' },
            ];
            processColumnQueue(
              pendingColBatch.remaining,
              nextResolved,
              pendingColBatch.totalCount
            );
          } else {
            executeSingleCopy('ADD');
          }
        }}
        onReplace={(existingId) => {
          if (pendingColBatch) {
            const nextResolved: BatchColumnDecision[] = [
              ...pendingColBatch.resolved,
              {
                columnId: pendingColBatch.currentCol.id,
                mode: 'REPLACE',
                replaceColumnId: existingId,
              },
            ];
            processColumnQueue(
              pendingColBatch.remaining,
              nextResolved,
              pendingColBatch.totalCount
            );
          } else {
            executeSingleCopy('REPLACE', existingId);
          }
        }}
      />
    </>
  );
};
