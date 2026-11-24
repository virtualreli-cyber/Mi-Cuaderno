import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  Copy,
  Eraser,
  FileX2,
  FolderOutput,
  GraduationCap,
  LayoutGrid,
  Lock,
  Pencil,
  Trash2,
} from 'lucide-react';
import { PASTEL_SWATCHES } from '../../constants/colors';
import { DEFAULT_LOMLOE_KEY_COMPETENCES } from '../../data/lomloeReligion';
import { useGradebook } from '../../context/GradebookContext';
import { findCopyConflicts } from '../../engine/copyConflictEngine';
import { countEmptyGradesInColumns } from '../../engine/gradeMath';
import { compareLomloeCodes, resolveBookCurriculum } from '../../engine/lomloe';
import { getCanonicalItemOrder } from '../../engine/tabLayout';
import type {
  ColorMode,
  ColumnEditorMode,
  ColumnEntity,
  ColumnType,
} from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { LomloeCompetenceBadge } from '../lomloe/LomloeCompetenceBadge';
import { CopyConflictModal, type PendingCopyConflict } from './CopyConflictModal';

interface ColumnModalProps {
  open: boolean;
  onClose: () => void;
  editingColumn: ColumnEntity | null;
  presetType?: ColumnType;
  presetFolderId?: string | null;
  onOpenRubricBuilder: () => void;
}

export const ColumnModal: React.FC<ColumnModalProps> = ({
  open,
  onClose,
  editingColumn,
  presetType = 'NUMERIC',
  presetFolderId = null,
  onOpenRubricBuilder,
}) => {
  const {
    workspace,
    activeBook,
    activeTab,
    addColumn,
    updateColumn,
    deleteColumn,
    clearColumnCells,
    fillEmptyGradesWithNP,
    duplicateColumn,
    stepColumn,
    moveColumnToFolder,
    moveColumnToTab,
    copyColumnToTarget,
  } = useGradebook();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [color, setColor] = useState('#DBEAFE');
  const [type, setType] = useState<ColumnType>('NUMERIC');
  const [width, setWidth] = useState(80);
  const [folderId, setFolderId] = useState<string>('');
  const [orientation, setOrientation] = useState<'HORIZONTAL' | 'VERTICAL'>('HORIZONTAL');
  const [isLocked, setIsLocked] = useState(false);

  // Numeric & counter editor settings (defaults: 0-10, 2 decimals)
  const [editorMode, setEditorMode] = useState<ColumnEditorMode>('STANDARD');
  const [counterStep, setCounterStep] = useState<number>(1);
  const [minValue, setMinValue] = useState(0);
  const [maxValue, setMaxValue] = useState(10);
  const [decimals, setDecimals] = useState(2);
  const [passThreshold, setPassThreshold] = useState(5);
  const [colorMode, setColorMode] = useState<ColorMode>('NONE');

  // Average settings
  const [selectedSrcIds, setSelectedSrcIds] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [ignoreEmpty, setIgnoreEmpty] = useState(true);

  // Rubric settings
  const [rubricId, setRubricId] = useState('');
  const [rubricShowPercentage, setRubricShowPercentage] = useState(false);

  // LOMLOE criteria settings
  const [lomloeCriteriaIds, setLomloeCriteriaIds] = useState<string[]>([]);

  // Copy to another class/tab
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

  const emptyGradeCount = useMemo(() => {
    if (
      !editingColumn ||
      !activeBook ||
      !activeTab ||
      activeTab.isLocked ||
      editingColumn.isLocked ||
      editingColumn.type === 'AVERAGE'
    ) {
      return 0;
    }
    return countEmptyGradesInColumns(activeBook, [editingColumn.id]);
  }, [editingColumn, activeBook, activeTab]);

  const storedDataCount = useMemo(() => {
    if (!editingColumn || !activeBook) return 0;
    const suffix = `::${editingColumn.id}`;
    return Object.entries(activeBook.cells).filter(([k, cell]) => {
      if (!k.endsWith(suffix)) return false;
      return (
        (cell.grade !== null && cell.grade !== undefined) ||
        Boolean(cell.comment?.trim()) ||
        Boolean(cell.rubricEval && Object.keys(cell.rubricEval.selections ?? {}).length > 0)
      );
    }).length;
  }, [editingColumn, activeBook]);

  // Folders & columns available as sources for AVERAGE across all tabs in activeBook
  const candidateSources = useMemo(() => {
    if (!activeBook) return [];
    const list: Array<{ id: string; tabTitle: string; title: string; kind: 'FOLDER' | 'COL'; color: string }> = [];
    for (const t of activeBook.tabs) {
      for (const f of t.folders) {
        list.push({
          id: f.id,
          tabTitle: t.title,
          title: `Carpeta: ${f.title}`,
          kind: 'FOLDER',
          color: f.color,
        });
      }
      for (const c of t.columns) {
        if (c.id === editingColumn?.id) continue;
        list.push({
          id: c.id,
          tabTitle: t.title,
          title: c.title,
          kind: 'COL',
          color: c.color,
        });
      }
    }
    return list;
  }, [activeBook, editingColumn?.id]);

  useEffect(() => {
    if (!open) {
      setActionPopupMsg(null);
      return;
    }
    setCopyDoneMsg(null);
    setActionPopupMsg(null);
    setPendingConflict(null);
    if (editingColumn) {
      setTitle(editingColumn.title);
      setDescription(editingColumn.description ?? '');
      setDate(editingColumn.date ?? '');
      setColor(editingColumn.color);
      setType(editingColumn.type);
      setWidth(editingColumn.width);
      setFolderId(editingColumn.folderId ?? '');
      setOrientation(editingColumn.headerOrientation ?? 'HORIZONTAL');
      setIsLocked(Boolean(editingColumn.isLocked));
      setEditorMode(editingColumn.editorMode ?? 'STANDARD');
      setCounterStep(
        typeof editingColumn.counterStep === 'number' && editingColumn.counterStep > 0
          ? editingColumn.counterStep
          : 1
      );
      setMinValue(editingColumn.minValue);
      setMaxValue(editingColumn.maxValue);
      setDecimals(editingColumn.decimals);
      setPassThreshold(editingColumn.passThreshold);
      setColorMode(editingColumn.colorMode ?? 'NONE');
      setSelectedSrcIds(editingColumn.averageConfig?.sourceColumnIds ?? []);
      setWeights(editingColumn.averageConfig?.weights ?? {});
      setIgnoreEmpty(editingColumn.averageConfig?.ignoreEmpty ?? true);
      setRubricId(editingColumn.rubricId ?? workspace.rubrics[0]?.id ?? '');
      setRubricShowPercentage(Boolean(editingColumn.rubricShowPercentage));
      setLomloeCriteriaIds(editingColumn.lomloeCriteriaIds ?? []);
    } else {
      const idx = activeTab?.columns.length ?? 0;
      const defaultTitle =
        presetType === 'AVERAGE'
          ? `Media ${idx + 1}`
          : presetType === 'RUBRIC'
            ? `Rúbrica ${idx + 1}`
            : `Actividad ${idx + 1}`;
      setTitle(defaultTitle);
      setDescription('');
      setDate('');
      setColor(PASTEL_SWATCHES[(idx + 5) % PASTEL_SWATCHES.length].hex);
      setType(presetType);
      setWidth(80);
      setFolderId(presetFolderId ?? '');
      setOrientation('HORIZONTAL');
      setIsLocked(false);
      setEditorMode('STANDARD');
      setCounterStep(1);
      setMinValue(0);
      setMaxValue(10);
      setDecimals(2);
      setPassThreshold(activeBook?.passThreshold ?? 5);
      setColorMode('NONE');

      // For a new AVERAGE column, pre-select existing NUMERIC/RUBRIC columns in current tab
      if (presetType === 'AVERAGE' && activeTab) {
        const defaults = activeTab.columns
          .filter((c) => c.type !== 'AVERAGE')
          .map((c) => c.id);
        setSelectedSrcIds(defaults);
        const eqW: Record<string, number> = {};
        if (defaults.length > 0) {
          const share = Number((100 / defaults.length).toFixed(2));
          defaults.forEach((id, i) => {
            eqW[id] =
              i === defaults.length - 1
                ? Number((100 - share * (defaults.length - 1)).toFixed(2))
                : share;
          });
        }
        setWeights(eqW);
      } else {
        setSelectedSrcIds([]);
        setWeights({});
      }
      setIgnoreEmpty(true);
      setRubricId(workspace.rubrics[0]?.id ?? '');
      setRubricShowPercentage(false);
      setLomloeCriteriaIds([]);
    }

    const firstCls = workspace.classes[0];
    setCopyClassId(firstCls?.id ?? '');
    setCopyTabId(firstCls?.tabs[0]?.id ?? '');
    // Only initialize form state when opening or switching target column
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingColumn?.id, presetType, presetFolderId]);

  const itemOrder = activeTab ? getCanonicalItemOrder(activeTab) : [];
  const canMoveLeft = useMemo(() => {
    if (!editingColumn) return false;
    if (editingColumn.folderId) return true; // inside folder -> can always step left or out to the left
    return itemOrder.indexOf(editingColumn.id) > 0;
  }, [editingColumn, itemOrder]);

  const canMoveRight = useMemo(() => {
    if (!editingColumn) return false;
    if (editingColumn.folderId) return true; // inside folder -> can always step right or out to the right
    const idx = itemOrder.indexOf(editingColumn.id);
    return idx >= 0 && idx < itemOrder.length - 1;
  }, [editingColumn, itemOrder]);

  if (!activeBook || !activeTab) return null;

  const toggleSourceCol = (colId: string) => {
    setSelectedSrcIds((prev) => {
      if (prev.includes(colId)) {
        return prev.filter((id) => id !== colId);
      }
      const next = [...prev, colId];
      if (weights[colId] === undefined) {
        setWeights((w) => ({ ...w, [colId]: Math.round(100 / next.length) }));
      }
      return next;
    });
  };

  const applyAutomaticArithmeticMean = () => {
    if (selectedSrcIds.length === 0) return;
    const base = Math.floor((100 / selectedSrcIds.length) * 100) / 100;
    const next: Record<string, number> = {};
    let acc = 0;
    selectedSrcIds.forEach((id, idx) => {
      if (idx === selectedSrcIds.length - 1) {
        next[id] = Number((100 - acc).toFixed(2));
      } else {
        next[id] = base;
        acc += base;
      }
    });
    setWeights(next);
  };

  const weightSum = selectedSrcIds.reduce((s, id) => s + (weights[id] ?? 0), 0);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const safeStep = Math.max(0.05, Number(String(counterStep).replace(',', '.')) || 1);
    const stepDecs = (() => {
      const s = String(safeStep);
      const dot = s.indexOf('.');
      return dot >= 0 ? Math.min(3, s.length - dot - 1) : 0;
    })();
    const rawDecimals = Math.max(0, Math.min(3, Number(decimals)));
    const effectiveDecimals =
      type === 'NUMERIC' && editorMode !== 'STANDARD'
        ? Math.max(rawDecimals, stepDecs)
        : rawDecimals;

    const payload = {
      folderId: folderId || null,
      title: title.trim() || 'Columna',
      description: description.trim() || undefined,
      date: date.trim() || undefined,
      color,
      width: Math.max(36, Math.min(360, Number(width) || 120)),
      type,
      headerOrientation: orientation,
      isLocked,
      editorMode: type === 'NUMERIC' ? editorMode : undefined,
      counterStep: type === 'NUMERIC' && editorMode !== 'STANDARD' ? safeStep : undefined,
      minValue: Number(minValue),
      maxValue: Number(maxValue),
      decimals: effectiveDecimals,
      passThreshold: Number(passThreshold),
      colorMode,
      averageConfig:
        type === 'AVERAGE'
          ? {
              sourceColumnIds: selectedSrcIds,
              weights: Object.fromEntries(
                selectedSrcIds.map((id) => [id, Math.max(0, Number(weights[id] ?? 0))])
              ),
              ignoreEmpty,
            }
          : undefined,
      rubricId: type === 'RUBRIC' ? rubricId : undefined,
      rubricShowPercentage: type === 'RUBRIC' ? rubricShowPercentage : undefined,
      lomloeCriteriaIds,
    };

    if (editingColumn) {
      updateColumn(editingColumn.id, payload);
    } else {
      addColumn(payload);
    }
    onClose();
  };

  const copyTargetClass = workspace.classes.find((c) => c.id === copyClassId);
  const copyTargetTab = copyTargetClass?.tabs.find((t) => t.id === copyTabId);

  const executeCopyToClass = (resolution: 'ADD' | 'REPLACE', replaceColumnId?: string) => {
    if (!editingColumn || !copyClassId || !copyTabId) return;
    copyColumnToTarget(activeBook.id, editingColumn.id, copyClassId, copyTabId, {
      mode: resolution,
      replaceColumnId,
    });
    setPendingConflict(null);
    setCopyDoneMsg(
      resolution === 'REPLACE'
        ? 'Columna sustituida correctamente.'
        : 'Columna copiada correctamente.'
    );
  };

  const handleCopyColumnClick = () => {
    if (!editingColumn || !copyTargetClass || !copyTargetTab) return;
    setCopyDoneMsg(null);
    const matches = findCopyConflicts(
      copyTargetClass,
      'COLUMN',
      editingColumn.title,
      copyTargetTab.id
    );
    if (matches.length > 0) {
      setPendingConflict({
        kind: 'COLUMN',
        sourceTitle: editingColumn.title,
        targetClassName: copyTargetClass.name,
        targetTabTitle: copyTargetTab.title,
        matches,
      });
      return;
    }
    executeCopyToClass('ADD');
  };

  return (
    <>
      <Modal
      open={open}
      onClose={onClose}
      title={editingColumn ? `Configurar columna: ${editingColumn.title}` : 'Nueva Columna'}
      subtitle={`Pestaña actual: ${activeTab.title}`}
      maxWidthClass="w-[min(680px,calc(100dvw-16px))]"
    >
      <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
        {/* Column Type Selector */}
        <div>
          <label className="block font-semibold text-slate-700 mb-1.5">Tipo de columna</label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                {
                  v: 'NUMERIC',
                  label: 'Nota numérica',
                  desc: 'Escala, teclado o contadores',
                  icon: Pencil,
                },
                {
                  v: 'AVERAGE',
                  label: 'Media / Ponderada',
                  desc: 'Calculada con pesos o aritmética',
                  icon: Calculator,
                },
                {
                  v: 'RUBRIC',
                  label: 'Rúbrica',
                  desc: 'Criterios × niveles (doble clic)',
                  icon: LayoutGrid,
                },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = type === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setType(opt.v)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    active
                      ? 'border-blue-500 bg-blue-50 text-blue-950 shadow-2xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5" />
                    <span>{opt.label}</span>
                  </div>
                  <div className="text-[11px] opacity-80 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Numeric Cell Editing Mode (Standard vs Positive/Negative Counter vs Quick Counter +/-) */}
        {type === 'NUMERIC' && (
          <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-3">
            <div>
              <label className="block font-bold text-slate-800 mb-1.5">
                Forma de edición de las celdas
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    {
                      v: 'STANDARD',
                      label: 'Estándar',
                      desc: 'Doble clic abre el editor',
                    },
                    {
                      v: 'COUNTER_POS',
                      label: 'Contador (+)',
                      desc: 'Doble clic suma puntos',
                    },
                    {
                      v: 'COUNTER_NEG',
                      label: 'Contador (-)',
                      desc: 'Doble clic resta puntos',
                    },
                    {
                      v: 'QUICK_COUNTER',
                      label: 'Contador rápido (+/-)',
                      desc: 'Doble clic abre + y - en toda la columna',
                    },
                  ] as const
                ).map((m) => {
                  const isSel = editorMode === m.v;
                  return (
                    <button
                      key={m.v}
                      type="button"
                      onClick={() => setEditorMode(m.v)}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSel
                          ? 'border-indigo-500 bg-white text-indigo-950 ring-1 ring-indigo-300 shadow-2xs'
                          : 'border-slate-200 bg-white/75 text-slate-700 hover:bg-white'
                      }`}
                    >
                      <div className="font-bold text-[11.5px] leading-tight">{m.label}</div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">
                        {m.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {editorMode !== 'STANDARD' && (
              <div className="pt-2 border-t border-indigo-200/70 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="font-semibold text-slate-700">
                    Puntos por pulsación:
                  </label>
                  <input
                    type="number"
                    min={0.05}
                    step="0.05"
                    value={counterStep}
                    onChange={(e) => setCounterStep(Number(e.target.value))}
                    className="w-20 border border-slate-300 rounded-lg px-2 py-1 bg-white font-bold tabular-nums text-center"
                  />
                  <div className="flex items-center gap-1">
                    {[0.25, 0.5, 1, 2].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCounterStep(preset)}
                        className={`px-2 py-0.5 rounded-lg border text-[11px] font-semibold tabular-nums ${
                          counterStep === preset
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {String(preset).replace('.', ',')}
                      </button>
                    ))}
                  </div>
                </div>

                {editorMode === 'COUNTER_NEG' && minValue >= 0 && (
                  <button
                    type="button"
                    onClick={() => setMinValue(-10)}
                    className="px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 text-[11px] font-semibold border border-amber-300"
                  >
                    Permitir negativos (Mín: -10)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Basic Info */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">Título de la columna</label>
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Fecha / Subtítulo</label>
            <input
              type="text"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="Ej: 18/11"
              className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Carpeta contenedora</label>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-2.5 py-2 bg-white"
            >
              <option value="">Sin carpeta (suelta)</option>
              {activeTab.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Anchura ({width} px)
            </label>
            <input
              type="range"
              min={36}
              max={280}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="w-full accent-blue-600 mt-2 cursor-pointer"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Orientación título</label>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as 'HORIZONTAL' | 'VERTICAL')}
              className="w-full border border-slate-300 rounded-xl px-2.5 py-2 bg-white"
            >
              <option value="HORIZONTAL">Horizontal</option>
              <option value="VERTICAL">Vertical (90°)</option>
            </select>
          </div>
        </div>

        {/* Color picker */}
        <div>
          <label className="block font-semibold text-slate-700 mb-1.5">Color de cabecera</label>
          <div className="flex flex-wrap items-center gap-2">
            {PASTEL_SWATCHES.map((sw) => (
              <button
                key={sw.hex}
                type="button"
                onClick={() => setColor(sw.hex)}
                title={sw.name}
                className={`w-6 h-6 rounded-lg border-2 ${
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
              className="w-7 h-6 rounded border border-slate-300 cursor-pointer"
            />
          </div>
        </div>

        {/* Scale & Conditional Colors */}
        <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
          <div className="font-bold text-slate-800">Escala numérica y color de celdas</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-slate-600 mb-1">Mínimo</label>
              <input
                type="number"
                step="0.5"
                value={minValue}
                onChange={(e) => setMinValue(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">Máximo</label>
              <input
                type="number"
                step="0.5"
                value={maxValue}
                onChange={(e) => setMaxValue(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">Decimales</label>
              <select
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
              >
                <option value={0}>0</option>
                <option value={1}>1</option>
                <option value={2}>2 (por defecto)</option>
                <option value={3}>3</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-600 mb-1">Aprobado en</label>
              <input
                type="number"
                step="0.1"
                value={passThreshold}
                onChange={(e) => setPassThreshold(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-600 font-medium mb-1">
              Resaltado visual de las notas
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
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-slate-600">
                <span className="inline-flex items-center gap-1 font-semibold">
                  <span className="w-3 h-3 rounded-sm bg-[#FCA5A5] border border-black/10" />
                  <span>&lt; {passThreshold}: Rojo pastel</span>
                </span>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <span className="w-3 h-3 rounded-sm bg-[#FED7AA] border border-black/10" />
                  <span>&lt; {passThreshold + 1}: Naranja pastel</span>
                </span>
                <span className="text-slate-400">· ≥ {passThreshold + 1}: Sin color</span>
              </div>
            )}
          </div>
        </div>

        {/* AVERAGE Configuration */}
        {type === 'AVERAGE' && (
          <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/40 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-bold text-slate-900">Carpetas, Columnas y Ponderación</div>
                <div className="text-[11px] text-slate-500">
                  Suma actual: <strong className="text-slate-800">{weightSum.toFixed(1)}%</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={applyAutomaticArithmeticMean}
                disabled={selectedSrcIds.length === 0}
                className="px-3 py-1.5 rounded-xl bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-40 flex items-center gap-1.5 shadow-2xs"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>Media aritmética automática</span>
              </button>
            </div>

            {candidateSources.length === 0 ? (
              <p className="text-slate-500 italic">
                Añade primero carpetas u otras columnas en la clase para poder promediarlas.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {candidateSources.map((src) => {
                  const checked = selectedSrcIds.includes(src.id);
                  return (
                    <div
                      key={src.id}
                      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border ${
                        checked ? 'bg-white border-blue-300' : 'bg-white/60 border-slate-200'
                      }`}
                    >
                      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSourceCol(src.id)}
                          className="accent-blue-600"
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                          style={{ backgroundColor: src.color }}
                        />
                        <span className="truncate font-medium text-slate-800">
                          <span className="text-slate-400 mr-1">[{src.tabTitle}]</span>
                          {src.kind === 'FOLDER' ? (
                            <strong className="text-slate-900">{src.title}</strong>
                          ) : (
                            src.title
                          )}
                        </span>
                      </label>

                      {checked && (
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={0}
                            step="0.5"
                            value={weights[src.id] ?? 0}
                            onChange={(e) =>
                              setWeights((prev) => ({
                                ...prev,
                                [src.id]: Math.max(0, Number(e.target.value)),
                              }))
                            }
                            className="w-16 border border-slate-300 rounded-lg px-2 py-1 text-right font-semibold bg-white tabular-nums"
                          />
                          <span className="text-slate-500">%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
              <input
                type="checkbox"
                checked={ignoreEmpty}
                onChange={(e) => setIgnoreEmpty(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Ignorar celdas vacías (solo promediar tareas evaluadas)</span>
            </label>
          </div>
        )}

        {/* RUBRIC Configuration */}
        {type === 'RUBRIC' && (
          <div className="p-3.5 rounded-xl border border-purple-200 bg-purple-50/40 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="font-bold text-slate-900">Rúbrica asociada</label>
              <button
                type="button"
                onClick={onOpenRubricBuilder}
                className="text-purple-700 font-semibold hover:underline"
              >
                Crear / Editar rúbricas...
              </button>
            </div>
            <select
              value={rubricId}
              onChange={(e) => setRubricId(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white text-slate-800"
            >
              {workspace.rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({r.criteria.length} criterios × {r.levels.length} niveles)
                </option>
              ))}
            </select>

            <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-purple-200/70">
              <div className="text-[11px] text-slate-600 leading-snug max-w-md">
                Las rúbricas funcionan en <strong>%</strong>, pero se muestran convertidas a nota de{' '}
                <strong>0 a 10</strong> por defecto (y al copiar siempre se copia la nota de 0 a 10).
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={rubricShowPercentage}
                onClick={() => setRubricShowPercentage((v) => !v)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors shrink-0 ${
                  rubricShowPercentage
                    ? 'bg-purple-600 border-purple-600 text-white'
                    : 'bg-white border-purple-300 text-purple-800 hover:bg-purple-50'
                }`}
              >
                {rubricShowPercentage ? 'No convertir: ON (mostrando %)' : 'No convertir (ver en %)'}
              </button>
            </div>
          </div>
        )}

        {/* LOMLOE Criteria selector */}
        {(() => {
          const bookCurr = resolveBookCurriculum(
            activeBook,
            workspace.lomloeCurricula
          );
          if (!bookCurr) return null;
          const kcs =
            workspace.lomloeKeyCompetences &&
            workspace.lomloeKeyCompetences.length > 0
              ? workspace.lomloeKeyCompetences
              : DEFAULT_LOMLOE_KEY_COMPETENCES;
          const kcMap = new Map(kcs.map((k) => [k.id, k]));
          const selectedSet = new Set(lomloeCriteriaIds);
          const sortedCriteria = [...bookCurr.criteria].sort((a, b) =>
            compareLomloeCodes(a.code, b.code)
          );
          return (
            <div className="p-3.5 rounded-2xl border border-indigo-200 bg-indigo-50/40 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-bold text-indigo-950">
                  <GraduationCap className="w-4 h-4 text-indigo-600" />
                  <span>Criterios de evaluación LOMLOE ({bookCurr.name})</span>
                </div>
                {lomloeCriteriaIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setLomloeCriteriaIds([])}
                    className="text-[11px] font-semibold text-indigo-700 hover:underline"
                  >
                    Limpiar ({lomloeCriteriaIds.length})
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sortedCriteria.map((cr) => {
                  const active = selectedSet.has(cr.id) || selectedSet.has(cr.code);
                  const ce = bookCurr.specificCompetences.find(
                    (c) => c.id === cr.specificCompetenceId
                  );
                  const kcIds =
                    cr.keyCompetenceIds && cr.keyCompetenceIds.length > 0
                      ? cr.keyCompetenceIds
                      : ce?.keyCompetenceIds ?? [];
                  return (
                    <button
                      key={cr.id}
                      type="button"
                      title={cr.description}
                      onClick={() =>
                        setLomloeCriteriaIds((prev) =>
                          prev.includes(cr.id)
                            ? prev.filter((id) => id !== cr.id)
                            : [...prev, cr.id]
                        )
                      }
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl border text-[11px] font-bold transition-all ${
                        active
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300'
                      }`}
                    >
                      <span>{cr.code}</span>
                      {!active &&
                        kcIds.slice(0, 2).map((kid) => {
                          const kc = kcMap.get(kid);
                          return kc ? (
                            <LomloeCompetenceBadge
                              key={kid}
                              competence={kc}
                              sizePx={11}
                            />
                          ) : null;
                        })}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Extra controls when editing existing column: lock, reorder, move/copy */}
        {editingColumn && (
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-3">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800">
              <input
                type="checkbox"
                checked={isLocked}
                onChange={(e) => setIsLocked(e.target.checked)}
                className="accent-blue-600"
              />
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span>Bloquear edición en esta columna</span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canMoveLeft}
                onClick={() => stepColumn(editingColumn.id, 'LEFT')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Mover izq.</span>
              </button>
              <button
                type="button"
                disabled={!canMoveRight}
                onClick={() => stepColumn(editingColumn.id, 'RIGHT')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1"
              >
                <span>Mover der.</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              {editingColumn.folderId && (
                <button
                  type="button"
                  onClick={() => {
                    moveColumnToFolder(editingColumn.id, null);
                    setFolderId('');
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold flex items-center gap-1"
                >
                  <FolderOutput className="w-3.5 h-3.5" />
                  <span>Sacar de carpeta</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  duplicateColumn(editingColumn.id, false);
                  onClose();
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5 text-blue-600" />
                <span>Duplicar columna</span>
              </button>

              {activeBook.tabs.length > 1 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      moveColumnToTab(editingColumn.id, e.target.value);
                      onClose();
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700"
                >
                  <option value="">Mover a pestaña...</option>
                  {activeBook.tabs
                    .filter((t) => t.id !== activeTab.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              )}
            </div>

            {/* Copy to another class */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-600">Copiar columna a:</span>
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
                onClick={handleCopyColumnClick}
                className="px-2.5 py-1 rounded-lg bg-slate-800 text-white font-semibold hover:bg-slate-900"
              >
                Copiar
              </button>
              {copyDoneMsg && <span className="text-emerald-700 font-semibold">{copyDoneMsg}</span>}
            </div>
          </div>
        )}

        {/* Sticky Footer Actions (always visible & clickable without clipping at modal bottom edge) */}
        <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-3 bg-white/95 backdrop-blur-xs border-t border-slate-200 z-20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {editingColumn ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {editingColumn.type !== 'AVERAGE' && !editingColumn.isLocked && !activeTab.isLocked && (
                  <button
                    type="button"
                    disabled={emptyGradeCount === 0}
                    onClick={() => {
                      const res = fillEmptyGradesWithNP([editingColumn.id]);
                      if (res.filledCount > 0) {
                        flashPopup(
                          `${res.filledCount} ${
                            res.filledCount === 1 ? 'celda sin nota rellenada' : 'celdas sin nota rellenadas'
                          } con 0 (NP). Ctrl/Cmd + Z para deshacer.`
                        );
                      }
                    }}
                    title="Rellena con 0 y el texto NP todas las celdas sin nota (ignora comentarios previos; no toca celdas que ya tienen nota)"
                    className="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50/75 hover:bg-indigo-100 disabled:opacity-40 text-indigo-900 font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <FileX2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Rellenar vacías: 0 NP ({emptyGradeCount})</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={storedDataCount === 0}
                  onClick={() => {
                    clearColumnCells(editingColumn.id);
                    flashPopup(
                      `Borrados todos los datos (${storedDataCount}) de la columna. Puedes revertir con Ctrl/Cmd + Z.`
                    );
                  }}
                  title="Vacía todas las notas, comentarios y rúbricas de esta columna con un clic"
                  className="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100 disabled:opacity-40 text-amber-900 font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>Borrar todos los datos ({storedDataCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`¿Eliminar la columna "${editingColumn.title}" y sus notas?`)) {
                      deleteColumn(editingColumn.id);
                      onClose();
                    }
                  }}
                  className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar columna</span>
                </button>
              </div>
            ) : (
              <span />
            )}

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
                <span>{editingColumn ? 'Guardar cambios' : 'Crear columna'}</span>
              </button>
            </div>
          </div>
        </div>
      </form>
    </Modal>

    <CopyConflictModal
      conflict={pendingConflict}
      onCancel={() => setPendingConflict(null)}
      onAddBoth={() => executeCopyToClass('ADD')}
      onReplace={(existingId) => executeCopyToClass('REPLACE', existingId)}
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
