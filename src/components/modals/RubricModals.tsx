import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Edit3, Plus, RotateCcw, Scale, Trash2 } from 'lucide-react';
import { getRubricLevelPastelColor } from '../../constants/colors';
import { useGradebook } from '../../context/GradebookContext';
import {
  computeRubricPercentage,
  computeRubricScore,
  formatGrade,
  makeId,
  normalizeRubricLevels,
} from '../../engine/gradeMath';
import {
  cellKey,
  type ColumnEntity,
  type RubricCellEval,
  type RubricEntity,
  type RubricLevel,
  type StudentEntity,
} from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { usePinchZoom, ZoomControls } from '../common/ZoomControls';

// ============================================================================
// Auto-growing textarea (always shows 100% of text vertically, zero internal scroll, never widens)
// ============================================================================
interface AutoGrowTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

const AutoGrowTextarea: React.FC<AutoGrowTextareaProps> = ({
  value,
  onChange,
  className = '',
  ...rest
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 32)}px`;
  };

  useLayoutEffect(() => {
    resize();
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full overflow-hidden resize-none whitespace-pre-wrap break-words leading-snug ${className}`}
      {...rest}
    />
  );
};

/**
 * Recolors levels in place based on their current percentage ranking
 * (highest percentage = pastel green, lowest = pastel red) without reordering mid-keystroke.
 */
function recolorLevelsByRank(levels: RubricLevel[]): RubricLevel[] {
  const ranked = [...levels]
    .map((lvl, idx) => ({ id: lvl.id, pct: lvl.percentage, idx }))
    .sort((a, b) => b.pct - a.pct || a.idx - b.idx);
  const rankMap = new Map<string, number>();
  ranked.forEach((item, rank) => rankMap.set(item.id, rank));
  return levels.map((lvl) => ({
    ...lvl,
    color: getRubricLevelPastelColor(rankMap.get(lvl.id) ?? 0, levels.length),
  }));
}

// ============================================================================
// 1. iDoceo-style Rubric Grader Modal (opens on double-click of RUBRIC cell)
// ============================================================================
interface RubricGraderModalProps {
  open: boolean;
  onClose: () => void;
  column: ColumnEntity | null;
  students: StudentEntity[];
  initialStudentId: string | null;
}

export const RubricGraderModal: React.FC<RubricGraderModalProps> = ({
  open,
  onClose,
  column,
  students,
  initialStudentId,
}) => {
  const { workspace, activeBook, setCellRubricEval, clearCell, updateColumn, updateSettings } =
    useGradebook();
  const [studentId, setStudentId] = useState<string | null>(initialStudentId);
  const [selections, setSelections] = useState<RubricCellEval['selections']>({});
  const [comment, setComment] = useState('');
  const [selectionModified, setSelectionModified] = useState(false);

  const rubricGridRef = useRef<HTMLDivElement>(null);
  const rubricZoom = workspace.settings.rubricZoom ?? 1;
  usePinchZoom(
    rubricGridRef,
    rubricZoom,
    (z) => updateSettings({ rubricZoom: z }),
    { min: 0.6, max: 1.6, enabled: open }
  );

  const rawRubric = useMemo(
    () => workspace.rubrics.find((r) => r.id === column?.rubricId) ?? workspace.rubrics[0] ?? null,
    [workspace.rubrics, column?.rubricId]
  );

  // Always display rubric levels from HIGHEST achievement (left, pastel green) to LOWEST (right, pastel red)
  const rubric = useMemo(
    () =>
      rawRubric
        ? {
            ...rawRubric,
            levels: normalizeRubricLevels(rawRubric.levels),
          }
        : null,
    [rawRubric]
  );

  useEffect(() => {
    if (open) setStudentId(initialStudentId);
  }, [open, initialStudentId]);

  useEffect(() => {
    if (!open || !studentId || !column || !activeBook) return;
    const cell = activeBook.cells[cellKey(studentId, column.id)];
    setSelections(cell?.rubricEval?.selections ? structuredClone(cell.rubricEval.selections) : {});
    setComment(cell?.comment ?? '');
    setSelectionModified(false);
  }, [open, studentId, column, activeBook]);

  if (!column || !rubric || !activeBook || !studentId) return null;

  const stIdx = students.findIndex((s) => s.id === studentId);
  const student = students[stIdx];
  const currentCell = activeBook.cells[cellKey(studentId, column.id)];
  const hasActiveManualOverride = Boolean(currentCell?.manualOverride) && !selectionModified;

  const computedScore = computeRubricScore(rubric, { rubricId: rubric.id, selections });
  const computedPct = computeRubricPercentage(rubric, { rubricId: rubric.id, selections });
  const displayScore = hasActiveManualOverride ? (currentCell?.grade ?? null) : computedScore;
  const displayPct = hasActiveManualOverride
    ? currentCell?.grade !== null && currentCell?.grade !== undefined
      ? Number(((currentCell.grade / (rubric.maxScore - rubric.minScore || 10)) * 100).toFixed(1))
      : null
    : computedPct;

  const liveCol =
    activeBook.tabs.flatMap((t) => t.columns).find((c) => c.id === column.id) ?? column;
  const showAsPercent = Boolean(liveCol.rubricShowPercentage);

  const commitCurrent = (forceRubricCalc = false) => {
    const preserveManual = hasActiveManualOverride && !forceRubricCalc;
    setCellRubricEval(studentId, column.id, { rubricId: rubric.id, selections }, comment, preserveManual);
  };

  const navigate = (delta: number) => {
    commitCurrent();
    const next = students[stIdx + delta];
    if (next) setStudentId(next.id);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        commitCurrent();
        onClose();
      }}
      title={rubric.title}
      subtitle={`Columna: ${column.title}`}
      maxWidthClass="w-[min(980px,96vw)]"
      headerActions={
        <div className="px-3 py-1 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 font-bold text-xs sm:text-sm tabular-nums whitespace-nowrap">
          Nota: {displayScore !== null ? formatGrade(displayScore, rubric.decimals) : '—'}
          {displayPct !== null && (
            <span className="ml-1.5 text-xs font-semibold text-blue-700 opacity-85">
              ({Number.isInteger(displayPct) ? displayPct : displayPct.toFixed(1)}%)
            </span>
          )}
        </div>
      }
    >
      <div className="p-5 space-y-3 text-xs">
        {/* Student navigation header */}
        <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
          <button
            type="button"
            disabled={stIdx <= 0}
            onClick={() => navigate(-1)}
            className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 font-semibold flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Anterior</span>
          </button>

          <div className="text-center min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">
              {student ? `${student.firstName} ${student.lastName}` : 'Alumno'}
            </div>
            <div className="text-[11px] text-slate-500">
              {stIdx + 1} de {students.length}
            </div>
          </div>

          <button
            type="button"
            disabled={stIdx < 0 || stIdx >= students.length - 1}
            onClick={() => navigate(1)}
            className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 font-semibold flex items-center gap-1"
          >
            <span>Siguiente</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Display mode & Zoom controls toolbar (keeps modal title uncluttered) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={showAsPercent}
            onClick={() => updateColumn(column.id, { rubricShowPercentage: !showAsPercent })}
            title="Por defecto las rúbricas muestran la nota traducida de 0 a 10. Activa para mostrar % en la tabla (al copiar siempre se copia 0–10)."
            className={`px-2.5 py-1 rounded-xl border text-xs font-semibold transition-colors ${
              showAsPercent
                ? 'bg-purple-600 border-purple-600 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {showAsPercent ? 'No convertir (%)' : 'Convertida (0–10)'}
          </button>

          <ZoomControls
            compact
            zoom={rubricZoom}
            min={0.6}
            max={1.6}
            onChangeZoom={(z) => updateSettings({ rubricZoom: z })}
          />
        </div>

        {/* Manual override notice banner if applicable */}
        {hasActiveManualOverride && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
            <span>
              Esta celda tiene una <strong>nota editada manualmente ({formatGrade(currentCell?.grade, rubric.decimals)})</strong>. Si seleccionas cualquier casilla de la rúbrica, se volverá a calcular automáticamente.
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectionModified(true);
                commitCurrent(true);
              }}
              className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 font-semibold flex items-center gap-1 shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Usar cálculo de rúbrica</span>
            </button>
          </div>
        )}

        {/* Criteria x Levels Grid (fixed table layout + zero font-weight shift on selection!) */}
        <div ref={rubricGridRef} className="overflow-x-auto border border-slate-200 rounded-xl">
          <table
            style={{
              width: `${Math.round(Math.max(100, rubricZoom * 100))}%`,
              fontSize: `${Number((12 * rubricZoom).toFixed(2))}px`,
            }}
            className="table-fixed border-collapse"
          >
            <colgroup>
              <col className="w-[22%]" />
              {rubric.levels.map((lvl) => (
                <col key={`col-${lvl.id}`} style={{ width: `${78 / rubric.levels.length}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-slate-100">
                <th className="p-2 text-left font-bold text-slate-700 border-b border-r border-slate-200 text-[0.95em]">
                  Criterio (Peso)
                </th>
                {rubric.levels.map((lvl) => (
                  <th
                    key={lvl.id}
                    style={{ backgroundColor: lvl.color }}
                    className="p-2 text-center font-bold text-slate-900 border-b border-r border-slate-200 last:border-r-0 text-[0.95em]"
                  >
                    <div>{lvl.title}</div>
                    <div className="text-[0.85em] font-semibold text-slate-700 opacity-85">
                      {lvl.percentage}%
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rubric.criteria.map((crit) => {
                const chosenLvl = selections[crit.id]?.levelId;
                return (
                  <tr key={crit.id} className="border-b border-slate-200 last:border-b-0">
                    <td className="p-2 border-r border-slate-200 bg-slate-50/70 align-top">
                      <div className="font-bold text-slate-900 leading-snug text-[0.95em]">
                        {crit.title}
                      </div>
                      <div className="text-[0.88em] text-slate-500 mt-1">Peso: {crit.weight}%</div>
                    </td>
                    {rubric.levels.map((lvl) => {
                      const isPicked = chosenLvl === lvl.id;
                      const desc = rubric.descriptors[`${crit.id}::${lvl.id}`] ?? '';
                      return (
                        <td
                          key={lvl.id}
                          onClick={() => {
                            setSelectionModified(true);
                            setSelections((prev) => ({
                              ...prev,
                              [crit.id]: { levelId: lvl.id },
                            }));
                          }}
                          style={{
                            backgroundColor: isPicked ? lvl.color : '#FFFFFF',
                          }}
                          className={`p-2 border-r border-slate-200 last:border-r-0 align-top cursor-pointer relative transition-colors ${
                            isPicked
                              ? 'ring-2 ring-inset ring-slate-800/75 text-slate-950'
                              : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          {/* Reserved right padding + absolute checkmark + invariant font-normal => 0 px layout shift */}
                          <div className="pr-4 text-[0.9em] font-normal leading-snug whitespace-pre-wrap">
                            {desc || `${lvl.title} (${lvl.percentage}%)`}
                          </div>
                          <Check
                            aria-hidden={!isPicked}
                            className={`w-3.5 h-3.5 text-slate-900 absolute top-2 right-2 pointer-events-none transition-opacity ${
                              isPicked ? 'opacity-100' : 'opacity-0'
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Comentario adicional en la celda (no afecta a la nota)
          </label>
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Observación breve sobre esta rúbrica..."
            className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={() => {
              clearCell(studentId, column.id);
              onClose();
            }}
            className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Borrar evaluación</span>
          </button>

          <button
            type="button"
            onClick={() => {
              commitCurrent();
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Guardar y cerrar</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ============================================================================
// 2. Rubric Builder / Library Modal
// ============================================================================
interface RubricBuilderModalProps {
  open: boolean;
  onClose: () => void;
}

export const RubricBuilderModal: React.FC<RubricBuilderModalProps> = ({ open, onClose }) => {
  const { workspace, saveRubric, deleteRubric, updateSettings } = useGradebook();
  const [editing, setEditing] = useState<RubricEntity | null>(null);
  const builderGridRef = useRef<HTMLDivElement>(null);
  const rubricZoom = workspace.settings.rubricZoom ?? 1;
  usePinchZoom(
    builderGridRef,
    rubricZoom,
    (z) => updateSettings({ rubricZoom: z }),
    { min: 0.6, max: 1.6, enabled: open && Boolean(editing) }
  );

  const startNewRubric = () => {
    const l1 = makeId('lvl');
    const l2 = makeId('lvl');
    const l3 = makeId('lvl');
    const l4 = makeId('lvl');
    const c1 = makeId('crit');
    const c2 = makeId('crit');

    const levels = normalizeRubricLevels([
      { id: l4, title: 'Excelente', percentage: 100, color: '' },
      { id: l3, title: 'Avanzado', percentage: 80, color: '' },
      { id: l2, title: 'Básico', percentage: 55, color: '' },
      { id: l1, title: 'Inicial', percentage: 25, color: '' },
    ]);

    setEditing({
      id: '',
      title: 'Nueva Rúbrica',
      description: '',
      minScore: 0,
      maxScore: 10,
      decimals: 2,
      levels,
      criteria: [
        { id: c1, title: 'Criterio 1', weight: 50 },
        { id: c2, title: 'Criterio 2', weight: 50 },
      ],
      descriptors: {},
    });
  };

  const openForEditing = (r: RubricEntity) => {
    const cloned = structuredClone(r);
    cloned.levels = normalizeRubricLevels(cloned.levels);
    setEditing(cloned);
  };

  const equalizeCriteriaWeights = () => {
    if (!editing || editing.criteria.length === 0) return;
    const base = Math.floor((100 / editing.criteria.length) * 100) / 100;
    const next = editing.criteria.map((c, idx) => ({
      ...c,
      weight:
        idx === editing.criteria.length - 1
          ? Number((100 - base * (editing.criteria.length - 1)).toFixed(2))
          : base,
    }));
    setEditing({ ...editing, criteria: next });
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        setEditing(null);
        onClose();
      }}
      title={editing ? `Editar rúbrica: ${editing.title}` : 'Biblioteca de Rúbricas'}
      subtitle="Niveles ordenados de mayor logro (izquierda, verde) a menor logro (derecha, rojo) · Escala en % convertida a 0–10"
      maxWidthClass="w-[min(1040px,96vw)]"
      headerActions={
        editing ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={() => {
                saveRubric({
                  ...editing,
                  levels: normalizeRubricLevels(editing.levels),
                });
                setEditing(null);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Guardar rúbrica</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startNewRubric}
            className="px-3.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nueva rúbrica</span>
          </button>
        )
      }
    >
      {!editing ? (
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {workspace.rubrics.map((r) => (
            <div
              key={r.id}
              className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">{r.title}</h3>
                {r.description && <p className="text-slate-500 mt-0.5">{r.description}</p>}
                <div className="text-[11px] text-slate-600 mt-1.5">
                  {r.criteria.length} criterios · {r.levels.length} niveles · Funciona en % (traducida {r.minScore}–{r.maxScore})
                </div>
                <div className="flex items-center gap-1 mt-2">
                  {normalizeRubricLevels(r.levels).map((lvl) => (
                    <span
                      key={lvl.id}
                      style={{ backgroundColor: lvl.color }}
                      className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-slate-800 border border-black/5"
                    >
                      {lvl.percentage}%
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openForEditing(r)}
                  className="p-1.5 rounded-lg bg-white border border-slate-200 hover:border-blue-400 text-blue-700"
                  title="Editar"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                {workspace.rubrics.length > 1 && (
                  <button
                    type="button"
                    onClick={() => deleteRubric(r.id)}
                    className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600"
                    title="Eliminar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Título</label>
              <input
                type="text"
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-sm bg-white"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nota Mín.</label>
              <input
                type="number"
                value={editing.minScore}
                onChange={(e) => setEditing({ ...editing, minScore: Number(e.target.value) })}
                className="w-full border border-slate-300 rounded-xl px-3 py-1.5 bg-white"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nota Máx.</label>
              <input
                type="number"
                value={editing.maxScore}
                onChange={(e) => setEditing({ ...editing, maxScore: Number(e.target.value) })}
                className="w-full border border-slate-300 rounded-xl px-3 py-1.5 bg-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setEditing({
                    ...editing,
                    criteria: [
                      ...editing.criteria,
                      {
                        id: makeId('crit'),
                        title: `Criterio ${editing.criteria.length + 1}`,
                        weight: 20,
                      },
                    ],
                  })
                }
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold"
              >
                + Criterio
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextLevels = normalizeRubricLevels([
                    ...editing.levels,
                    {
                      id: makeId('lvl'),
                      title: `Nivel ${editing.levels.length + 1}`,
                      percentage: 50,
                      color: '',
                    },
                  ]);
                  setEditing({ ...editing, levels: nextLevels });
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold"
              >
                + Nivel
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={equalizeCriteriaWeights}
                className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold flex items-center gap-1"
              >
                <Scale className="w-3.5 h-3.5" />
                <span>Repartir pesos al 100%</span>
              </button>
              <ZoomControls
                compact
                zoom={rubricZoom}
                min={0.6}
                max={1.6}
                onChangeZoom={(z) => updateSettings({ rubricZoom: z })}
              />
            </div>
          </div>

          <div ref={builderGridRef} className="border border-slate-200 rounded-xl overflow-x-auto">
            <table
              style={{
                width: `${Math.round(Math.max(100, rubricZoom * 100))}%`,
                fontSize: `${Number((12 * rubricZoom).toFixed(2))}px`,
              }}
              className="table-fixed border-collapse"
            >
              <colgroup>
                <col className="w-[22%]" />
                {editing.levels.map((lvl) => (
                  <col key={`edit-col-${lvl.id}`} style={{ width: `${78 / editing.levels.length}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr className="bg-slate-100">
                  <th className="p-2 border-b border-r border-slate-200 text-left">
                    Criterio y peso (%)
                  </th>
                  {editing.levels.map((lvl, lIdx) => (
                    <th
                      key={lvl.id}
                      style={{ backgroundColor: lvl.color }}
                      className="p-2 border-b border-r border-slate-200 last:border-r-0 align-top"
                    >
                      <input
                        type="text"
                        value={lvl.title}
                        onChange={(e) => {
                          const levels = [...editing.levels];
                          levels[lIdx] = { ...lvl, title: e.target.value };
                          setEditing({ ...editing, levels });
                        }}
                        className="w-full text-center font-bold bg-white/85 rounded px-1.5 py-0.5 mb-1 border border-black/10"
                      />
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={lvl.percentage}
                          onChange={(e) => {
                            const levels = [...editing.levels];
                            levels[lIdx] = { ...lvl, percentage: Number(e.target.value) };
                            setEditing({ ...editing, levels: recolorLevelsByRank(levels) });
                          }}
                          onBlur={() =>
                            setEditing((prev) =>
                              prev
                                ? { ...prev, levels: normalizeRubricLevels(prev.levels) }
                                : null
                            )
                          }
                          className="w-14 text-center bg-white/85 rounded px-1 py-0.5 border border-black/10 tabular-nums"
                        />
                        <span>%</span>
                        {editing.levels.length > 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({
                                ...editing,
                                levels: normalizeRubricLevels(
                                  editing.levels.filter((x) => x.id !== lvl.id)
                                ),
                              })
                            }
                            title="Eliminar nivel"
                            className="p-0.5 rounded hover:bg-black/10 text-rose-700"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {editing.criteria.map((crit, cIdx) => (
                  <tr key={crit.id} className="border-b border-slate-200 last:border-b-0">
                    <td className="p-2 border-r border-slate-200 bg-slate-50/70 align-top space-y-1.5">
                      <AutoGrowTextarea
                        value={crit.title}
                        onChange={(val) => {
                          const criteria = [...editing.criteria];
                          criteria[cIdx] = { ...crit, title: val };
                          setEditing({ ...editing, criteria });
                        }}
                        placeholder="Nombre del criterio..."
                        className="font-bold text-[1em] bg-white border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                      />
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-500">Peso:</span>
                          <input
                            type="number"
                            min={0}
                            value={crit.weight}
                            onChange={(e) => {
                              const criteria = [...editing.criteria];
                              criteria[cIdx] = { ...crit, weight: Number(e.target.value) };
                              setEditing({ ...editing, criteria });
                            }}
                            className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-right tabular-nums"
                          />
                          <span>%</span>
                        </div>
                        {editing.criteria.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({
                                ...editing,
                                criteria: editing.criteria.filter((x) => x.id !== crit.id),
                              })
                            }
                            className="text-rose-600 p-1 hover:bg-rose-50 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    {editing.levels.map((lvl) => {
                      const dKey = `${crit.id}::${lvl.id}`;
                      return (
                        <td
                          key={lvl.id}
                          className="p-1.5 border-r border-slate-200 last:border-r-0 align-top"
                        >
                          <AutoGrowTextarea
                            value={editing.descriptors[dKey] ?? ''}
                            placeholder="Descriptor del nivel..."
                            onChange={(val) =>
                              setEditing({
                                ...editing,
                                descriptors: { ...editing.descriptors, [dKey]: val },
                              })
                            }
                            className="text-[0.92em] bg-white border border-slate-200 rounded p-1.5 focus:outline-none focus:border-blue-400"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
};
