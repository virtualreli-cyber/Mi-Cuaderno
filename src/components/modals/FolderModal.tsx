import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileX2,
  FolderClosed,
  FolderOpen,
  RotateCcw,
  Scale,
  Trash2,
} from 'lucide-react';
import { PASTEL_SWATCHES } from '../../constants/colors';
import { useGradebook } from '../../context/GradebookContext';
import { findCopyConflicts } from '../../engine/copyConflictEngine';
import {
  countEmptyGradesInColumns,
  countFolderOverridesAndNotices,
} from '../../engine/gradeMath';
import { getCanonicalItemOrder } from '../../engine/tabLayout';
import type { ColorMode, FolderEntity, FolderSummaryMode } from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { CopyConflictModal, type PendingCopyConflict } from './CopyConflictModal';

interface FolderModalProps {
  open: boolean;
  onClose: () => void;
  tabId: string;
  folder: FolderEntity | null;
}

const MODES: { value: FolderSummaryMode; label: string }[] = [
  { value: 'ARITHMETIC_MEAN', label: 'Media aritmética' },
  { value: 'WEIGHTED_MEAN', label: 'Media ponderada' },
  { value: 'SUM', label: 'Suma total' },
  { value: 'MAX', label: 'Nota máxima' },
  { value: 'MIN', label: 'Nota mínima' },
];

export const FolderModal: React.FC<FolderModalProps> = ({ open, onClose, tabId, folder }) => {
  const {
    workspace,
    activeBook,
    updateFolder,
    toggleFolderCollapse,
    deleteFolder,
    stepFolder,
    copyFolderToTarget,
    fillEmptyGradesWithNP,
    restoreFolderCalculation,
  } = useGradebook();

  const [title, setTitle] = useState('');
  const [color, setColor] = useState('#DCFCE7');
  const [width, setWidth] = useState(64);
  const [summaryMode, setSummaryMode] = useState<FolderSummaryMode>('ARITHMETIC_MEAN');
  const [colorMode, setColorMode] = useState<ColorMode>('NONE');
  const [ignoreEmpty, setIgnoreEmpty] = useState(true);
  const [weights, setWeights] = useState<Record<string, number>>({});

  // Copy folder to another class
  const [copyClassId, setCopyClassId] = useState('');
  const [copyTabId, setCopyTabId] = useState('');
  const [copyDoneMsg, setCopyDoneMsg] = useState<string | null>(null);
  const [actionPopupMsg, setActionPopupMsg] = useState<string | null>(null);
  const actionPopupTimerRef = useRef<number | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingCopyConflict | null>(null);

  const flashPopup = (msg: string) => {
    setActionPopupMsg(msg);
    if (actionPopupTimerRef.current) window.clearTimeout(actionPopupTimerRef.current);
    actionPopupTimerRef.current = window.setTimeout(() => setActionPopupMsg(null), 3000);
  };

  useEffect(() => {
    return () => {
      if (actionPopupTimerRef.current) window.clearTimeout(actionPopupTimerRef.current);
    };
  }, []);

  const currentTab = useMemo(
    () => activeBook?.tabs.find((t) => t.id === tabId) ?? null,
    [activeBook, tabId]
  );

  const childCols = useMemo(() => {
    if (!currentTab || !folder) return [];
    return currentTab.columns
      .filter((c) => c.folderId === folder.id)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [currentTab, folder]);

  const itemOrder = useMemo(
    () => (currentTab ? getCanonicalItemOrder(currentTab) : []),
    [currentTab]
  );
  const folderPos = folder ? itemOrder.indexOf(folder.id) : -1;

  const editableChildColIds = useMemo(() => {
    if (!currentTab || currentTab.isLocked) return [];
    return childCols
      .filter((c) => c.type !== 'AVERAGE' && !c.isLocked)
      .map((c) => c.id);
  }, [currentTab, childCols]);

  const emptyFolderGradeCount = useMemo(() => {
    if (!activeBook || editableChildColIds.length === 0) return 0;
    return countEmptyGradesInColumns(activeBook, editableChildColIds);
  }, [activeBook, editableChildColIds]);

  const folderOverrideStats = useMemo(() => {
    if (!activeBook || !folder) return { manualCount: 0, noticeCount: 0, totalCount: 0 };
    return countFolderOverridesAndNotices(activeBook, folder.id);
  }, [activeBook, folder]);

  useEffect(() => {
    if (!open) {
      setActionPopupMsg(null);
      return;
    }
    if (!folder) return;
    setTitle(folder.title);
    setColor(folder.color);
    setWidth(folder.width ?? 64);
    setSummaryMode(folder.summaryMode ?? 'ARITHMETIC_MEAN');
    setColorMode(folder.colorMode ?? 'NONE');
    setIgnoreEmpty(folder.ignoreEmpty ?? true);
    setCopyDoneMsg(null);
    setActionPopupMsg(null);
    setPendingConflict(null);

    const w: Record<string, number> = {};
    const eq = childCols.length > 0 ? Number((100 / childCols.length).toFixed(2)) : 100;
    for (const c of childCols) {
      w[c.id] = folder.columnWeights?.[c.id] ?? eq;
    }
    setWeights(w);

    const firstCls = workspace.classes[0];
    setCopyClassId(firstCls?.id ?? '');
    setCopyTabId(firstCls?.tabs[0]?.id ?? '');
    // Only initialize form state when opening or switching target folder
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folder?.id]);

  if (!folder || !activeBook) return null;

  const autoEqualize = () => {
    if (childCols.length === 0) return;
    const eq = Number((100 / childCols.length).toFixed(2));
    const next: Record<string, number> = {};
    let sum = 0;
    childCols.forEach((c, i) => {
      if (i === childCols.length - 1) {
        next[c.id] = Number((100 - sum).toFixed(2));
      } else {
        next[c.id] = eq;
        sum += eq;
      }
    });
    setWeights(next);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateFolder(tabId, folder.id, {
      title: title.trim() || folder.title,
      color,
      width: Math.max(38, Math.min(280, Number(width) || 64)),
      summaryMode,
      colorMode,
      ignoreEmpty,
      columnWeights: weights,
    });
    onClose();
  };

  const copyTargetClass = workspace.classes.find((c) => c.id === copyClassId);
  const copyTargetTab = copyTargetClass?.tabs.find((t) => t.id === copyTabId);

  const executeCopyFolder = (resolution: 'ADD' | 'REPLACE', replaceFolderId?: string) => {
    if (!copyClassId || !copyTabId) return;
    copyFolderToTarget(activeBook.id, tabId, folder.id, copyClassId, copyTabId, {
      mode: resolution,
      replaceFolderId,
    });
    setPendingConflict(null);
    setCopyDoneMsg(
      resolution === 'REPLACE'
        ? 'Carpeta sustituida correctamente.'
        : 'Carpeta copiada correctamente.'
    );
  };

  const handleCopyFolderClick = () => {
    if (!copyTargetClass || !copyTargetTab) return;
    setCopyDoneMsg(null);
    const matches = findCopyConflicts(copyTargetClass, 'FOLDER', folder.title, copyTargetTab.id);
    if (matches.length > 0) {
      setPendingConflict({
        kind: 'FOLDER',
        sourceTitle: folder.title,
        targetClassName: copyTargetClass.name,
        targetTabTitle: copyTargetTab.title,
        matches,
      });
      return;
    }
    executeCopyFolder('ADD');
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Configurar carpeta: ${folder.title}`}
        subtitle="Color, posición, resumen al plegar y copia a otras clases"
        maxWidthClass="w-[min(580px,95vw)]"
        headerActions={
          <button
            type="button"
            onClick={() => {
              toggleFolderCollapse(tabId, folder.id);
              onClose();
            }}
            className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
          >
            {folder.isCollapsed ? (
              <>
                <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                <span>Desplegar</span>
              </>
            ) : (
              <>
                <FolderClosed className="w-3.5 h-3.5 text-amber-600" />
                <span>Plegar</span>
              </>
            )}
          </button>
        }
      >
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Nombre de la carpeta</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Anchura ({width} px)
              </label>
              <input
                type="range"
                min={38}
                max={240}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="w-full accent-blue-600 mt-2.5 cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">Color de carpeta</label>
            <div className="flex flex-wrap items-center gap-2">
              {PASTEL_SWATCHES.map((sw) => (
                <button
                  key={sw.hex}
                  type="button"
                  onClick={() => setColor(sw.hex)}
                  className={`w-7 h-7 rounded-lg border-2 ${
                    color.toLowerCase() === sw.hex.toLowerCase()
                      ? 'border-slate-900 scale-110'
                      : 'border-slate-200'
                  }`}
                  style={{ backgroundColor: sw.hex }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-8 h-7 rounded-lg border border-slate-300 cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              Cálculo mostrado al plegar la carpeta
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setSummaryMode(m.value)}
                  className={`p-2 rounded-xl border text-left font-semibold ${
                    summaryMode === m.value
                      ? 'border-blue-500 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {summaryMode === 'WEIGHTED_MEAN' && (
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-blue-600" />
                  <span>Pesos de columnas (%)</span>
                </span>
                <button
                  type="button"
                  onClick={autoEqualize}
                  className="px-2 py-1 rounded-lg bg-white border border-slate-200 hover:border-blue-400 text-blue-700 font-semibold"
                >
                  Media aritmética automática
                </button>
              </div>
              {childCols.length === 0 ? (
                <p className="text-slate-500">
                  Arrastra columnas dentro de esta carpeta para ponderarlas.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {childCols.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200"
                    >
                      <span className="truncate font-medium text-slate-800">{c.title}</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          value={weights[c.id] ?? 0}
                          onChange={(e) =>
                            setWeights((prev) => ({
                              ...prev,
                              [c.id]: Math.max(0, Number(e.target.value)),
                            }))
                          }
                          className="w-16 border border-slate-300 rounded px-2 py-1 text-right font-semibold"
                        />
                        <span>%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
            <label className="block font-semibold text-slate-700">
              Coloración de las notas de la carpeta
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { v: 'NONE', label: 'Sin color (neutro)' },
                  { v: 'TEXT_ONLY', label: 'En los números' },
                  { v: 'CELL_BG', label: 'En el relleno' },
                ] as const
              ).map((m) => (
                <button
                  key={m.v}
                  type="button"
                  onClick={() => setColorMode(m.v)}
                  className={`py-1.5 px-2 rounded-lg border font-semibold ${
                    colorMode === m.v
                      ? 'border-blue-500 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {colorMode !== 'NONE' && (
              <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-slate-600 pt-0.5">
                <span className="inline-flex items-center gap-1 font-semibold">
                  <span className="w-3 h-3 rounded-sm bg-[#FCA5A5] border border-black/10" />
                  <span>&lt; {activeBook.passThreshold}: Rojo pastel</span>
                </span>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <span className="w-3 h-3 rounded-sm bg-[#FED7AA] border border-black/10" />
                  <span>&lt; {activeBook.passThreshold + 1}: Naranja pastel</span>
                </span>
                <span className="text-slate-400">· ≥ {activeBook.passThreshold + 1}: Sin color</span>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
            <input
              type="checkbox"
              checked={ignoreEmpty}
              onChange={(e) => setIgnoreEmpty(e.target.checked)}
              className="accent-blue-600"
            />
            <span>Ignorar celdas vacías al calcular (no contarlas como 0)</span>
          </label>

          {/* Position & Copy to another class */}
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-600">Mover carpeta:</span>
              <button
                type="button"
                disabled={folderPos <= 0}
                onClick={() => stepFolder(tabId, folder.id, 'LEFT')}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Izquierda</span>
              </button>
              <button
                type="button"
                disabled={folderPos < 0 || folderPos >= itemOrder.length - 1}
                onClick={() => stepFolder(tabId, folder.id, 'RIGHT')}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1"
              >
                <span>Derecha</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-600">Copiar carpeta a:</span>
              <select
                value={copyClassId}
                onChange={(e) => {
                  setCopyClassId(e.target.value);
                  const cls = workspace.classes.find((c) => c.id === e.target.value);
                  setCopyTabId(cls?.tabs[0]?.id ?? '');
                }}
                className="border border-slate-200 rounded-lg px-2 py-1 bg-white"
              >
                {workspace.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={copyTabId}
                onChange={(e) => setCopyTabId(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1 bg-white"
              >
                {(copyTargetClass?.tabs ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCopyFolderClick}
                className="px-2.5 py-1 rounded-lg bg-slate-800 text-white font-semibold hover:bg-slate-900"
              >
                Copiar
              </button>
              {copyDoneMsg && <span className="text-emerald-700 font-semibold">{copyDoneMsg}</span>}
            </div>
          </div>

          <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-3 bg-white/95 backdrop-blur-xs border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 z-20">
            <div className="flex flex-wrap items-center gap-1.5">
              {!currentTab?.isLocked && editableChildColIds.length > 0 && (
                <button
                  type="button"
                  disabled={emptyFolderGradeCount === 0}
                  onClick={() => {
                    const res = fillEmptyGradesWithNP(editableChildColIds);
                    if (res.filledCount > 0) {
                      flashPopup(
                        `${res.filledCount} ${
                          res.filledCount === 1 ? 'celda sin nota rellenada' : 'celdas sin nota rellenadas'
                        } con 0 (NP) en ${res.affectedColumnCount} ${
                          res.affectedColumnCount === 1 ? 'tarea' : 'tareas'
                        }. Ctrl/Cmd + Z para deshacer.`
                      );
                    }
                  }}
                  title="Rellena con 0 y NP las celdas sin nota en todas las tareas editables de esta carpeta (no toca celdas con nota)"
                  className="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50/75 hover:bg-indigo-100 disabled:opacity-40 text-indigo-900 font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <FileX2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Rellenar vacías: 0 NP ({emptyFolderGradeCount})</span>
                </button>
              )}

              {!currentTab?.isLocked && (
                <button
                  type="button"
                  disabled={folderOverrideStats.totalCount === 0}
                  onClick={() => {
                    const count = restoreFolderCalculation(folder.id);
                    if (count > 0) {
                      flashPopup(
                        `Cálculo restituido en ${count} ${
                          count === 1 ? 'celda de esta carpeta' : 'celdas de esta carpeta'
                        }.`
                      );
                    }
                  }}
                  title="Restituye el cálculo automático en todas las celdas de esta carpeta editadas manualmente o con aviso"
                  className="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50/80 hover:bg-amber-100 disabled:opacity-40 text-amber-900 font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Restituir cálculo ({folderOverrideStats.totalCount})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  deleteFolder(tabId, folder.id);
                  onClose();
                }}
                className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Deshacer carpeta</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Guardar</span>
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <CopyConflictModal
        conflict={pendingConflict}
        onCancel={() => setPendingConflict(null)}
        onAddBoth={() => executeCopyFolder('ADD')}
        onReplace={(existingId) => executeCopyFolder('REPLACE', existingId)}
      />

      {actionPopupMsg &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-5 right-5 z-[95] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold shadow-2xl border border-slate-700/70 pointer-events-none"
          >
            {actionPopupMsg}
          </div>,
          document.body
        )}
    </>
  );
};
