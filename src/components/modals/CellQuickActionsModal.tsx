import React from 'react';
import {
  Calculator,
  Check,
  Columns3,
  Copy,
  Eraser,
  FileX2,
  FolderCog,
  LayoutGrid,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { getEducamosSnappedGrade, isCellOutdatedForEducamos } from '../../engine/educamos';
import {
  applyCounterDelta,
  computeFolderFormulaValue,
  computeFolderSummary,
  computeRubricCriterionResult,
  computeRubricScore,
  countFolderOverridesAndNotices,
  formatCellDisplayGrade,
  formatGrade,
} from '../../engine/gradeMath';
import {
  cellKey,
  type ColumnEntity,
  type FolderEntity,
  type RubricCriterion,
  type RubricEntity,
  type StudentEntity,
} from '../../types/gradebook';
import { Modal } from '../common/Modal';

export type CellQuickActionTarget =
  | {
      kind: 'COL';
      student: StudentEntity;
      col: ColumnEntity;
    }
  | {
      kind: 'FOLDER_SUMMARY';
      student: StudentEntity;
      folder: FolderEntity;
      childCols: ColumnEntity[];
    }
  | {
      kind: 'RUBRIC_CRITERION';
      student: StudentEntity;
      col: ColumnEntity;
      rubric: RubricEntity;
      criterion: RubricCriterion;
      criterionIndex: number;
    };

interface CellQuickActionsModalProps {
  target: CellQuickActionTarget | null;
  onClose: () => void;
  onEditCell: (student: StudentEntity, col: ColumnEntity) => void;
  onEditColumn: (col: ColumnEntity) => void;
  onEditFolder: (tabId: string, folder: FolderEntity) => void;
  onOpenRubricGrader: (student: StudentEntity, col: ColumnEntity) => void;
  onOpenQuickCounter: (columnId: string) => void;
  onShowToast: (msg: string) => void;
  makeVirtualFolderCol: (folder: FolderEntity, childCols: ColumnEntity[]) => ColumnEntity;
}

export const CellQuickActionsModal: React.FC<CellQuickActionsModalProps> = ({
  target,
  onClose,
  onEditCell,
  onEditColumn,
  onEditFolder,
  onOpenRubricGrader,
  onOpenQuickCounter,
  onShowToast,
  makeVirtualFolderCol,
}) => {
  const {
    workspace,
    activeBook,
    activeTab,
    setCellData,
    setCellRubricEval,
    setRubricCriterionForStudents,
    toggleColumnRubricExpanded,
    clearCell,
    markCellEducamosUpdated,
    restoreFolderCellCalculation,
    restoreFolderCalculation,
    recalculateActiveBook,
  } = useGradebook();

  if (!target || !activeBook || !activeTab) {
    return (
      <Modal open={false} onClose={onClose} title="Acciones rápidas" maxWidthClass="max-w-md">
        <div />
      </Modal>
    );
  }

  const student = target.student;
  const studentName = `${student.lastName}, ${student.firstName}`;
  const isTabLocked = Boolean(activeTab.isLocked);

  const copyGradeValue = (text: string | null) => {
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        // Ignore clipboard errors in restricted environments
      });
    }
    onShowToast(`Copiado: ${text}`);
    onClose();
  };

  if (target.kind === 'FOLDER_SUMMARY') {
    const folder = target.folder;
    const childCols = target.childCols;
    const fKey = cellKey(student.id, folder.id);
    const fCell = activeBook.cells[fKey];
    const formulaVal = computeFolderFormulaValue(folder, childCols, student.id, activeBook);
    const displayVal = computeFolderSummary(folder, childCols, student.id, activeBook);
    const formulaLabel = formulaVal !== null ? formatGrade(formulaVal, 2) : '—';
    const displayLabel = displayVal !== null ? formatGrade(displayVal, 2) : '—';
    const folderStats = countFolderOverridesAndNotices(activeBook, folder.id);
    const vCol = makeVirtualFolderCol(folder, childCols);
    const fComment = fCell?.comment?.trim() ?? '';

    return (
      <Modal
        open={true}
        onClose={onClose}
        title="Acciones rápidas · Carpeta"
        subtitle={studentName}
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Carpeta calculada
              </div>
              <div className="text-sm font-bold text-slate-900 truncate">{folder.title}</div>
              {fCell?.manualOverride ? (
                <div className="text-xs font-semibold text-amber-700 mt-0.5">
                  Editada manualmente (calculada: {formulaLabel})
                </div>
              ) : fCell?.autoRecalcNotice ? (
                <div className="text-xs font-semibold text-indigo-700 mt-0.5">
                  Recalculada automáticamente ({formulaLabel})
                </div>
              ) : (
                <div className="text-xs text-slate-500 mt-0.5">
                  Cálculo automático ({childCols.length} columnas)
                </div>
              )}
              {fComment && (
                <div className="text-xs text-slate-600 mt-1 line-clamp-2">
                  Comentario: {fComment}
                </div>
              )}
            </div>
            <div className="shrink-0 min-w-[56px] px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-center">
              <div className="text-lg font-extrabold tabular-nums text-slate-900">
                {displayLabel}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {!isTabLocked && (
              <button
                type="button"
                onClick={() => {
                  if (fCell?.manualOverride || fCell?.autoRecalcNotice) {
                    restoreFolderCellCalculation(student.id, folder.id);
                    onShowToast(
                      fCell.manualOverride
                        ? `Cálculo restituido (${formulaLabel})`
                        : 'Aviso ocultado y nota actualizada'
                    );
                  } else {
                    recalculateActiveBook();
                    onShowToast(`Nota calculada actualizada (${formulaLabel})`);
                  }
                  onClose();
                }}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {fCell?.manualOverride ? (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    <span>Restituir nota calculada ({formulaLabel})</span>
                  </>
                ) : fCell?.autoRecalcNotice ? (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    <span>Quitar aviso y dejar cálculo ({formulaLabel})</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Actualizar nota calculada</span>
                  </>
                )}
              </button>
            )}

            {!isTabLocked && folderStats.totalCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  const count = restoreFolderCalculation(folder.id);
                  if (count > 0) {
                    onShowToast(
                      `Cálculo restituido en ${count} ${count === 1 ? 'celda' : 'celdas'} de «${folder.title}»`
                    );
                  }
                  onClose();
                }}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <RotateCcw className="w-4 h-4 text-amber-700" />
                <span>Restituir toda la carpeta ({folderStats.totalCount})</span>
              </button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isTabLocked}
                onClick={() => {
                  onClose();
                  onEditCell(student, vCol);
                }}
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-45 text-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Pencil className="w-4 h-4 text-blue-600" />
                <span>Editar manual</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditFolder(activeTab.id, folder);
                }}
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <FolderCog className="w-4 h-4 text-slate-600" />
                <span>Configurar carpeta</span>
              </button>
            </div>

            {(displayVal !== null ||
              (!isTabLocked && (fCell?.manualOverride || fCell?.autoRecalcNotice || fComment))) && (
              <div className="flex items-center gap-2 pt-1">
                {displayVal !== null && (
                  <button
                    type="button"
                    onClick={() => copyGradeValue(formatGrade(displayVal, 2))}
                    className="flex-1 min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar nota</span>
                  </button>
                )}
                {!isTabLocked && (fCell?.manualOverride || fCell?.autoRecalcNotice || fComment) && (
                  <button
                    type="button"
                    onClick={() => {
                      clearCell(student.id, folder.id);
                      onShowToast('Nota manual y comentario limpiados');
                      onClose();
                    }}
                    className="flex-1 min-h-[42px] px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Limpiar celda</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  if (target.kind === 'RUBRIC_CRITERION') {
    const { col, rubric, criterion, criterionIndex } = target;
    const pCell = activeBook.cells[cellKey(student.id, col.id)];
    const critRes = computeRubricCriterionResult(rubric, criterion.id, pCell?.rubricEval);
    const showPct = Boolean(col.rubricShowPercentage || workspace.settings.showRubricsAsPercent);
    const isLocked = isTabLocked || Boolean(col.isLocked);

    return (
      <Modal
        open={true}
        onClose={onClose}
        title={`Acciones rápidas · Criterio C${criterionIndex + 1}`}
        subtitle={`${studentName} · ${col.title}`}
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
                {rubric.title}
              </div>
              <div className="text-sm font-bold text-slate-900">{criterion.title}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {critRes
                  ? `${critRes.level.title} (${critRes.percentage}%)`
                  : 'Sin valorar'}
              </div>
            </div>
            <div className="shrink-0 min-w-[56px] px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-center">
              <div className="text-lg font-extrabold tabular-nums text-slate-900">
                {critRes ? formatCellDisplayGrade(critRes.grade, col, showPct) : '—'}
              </div>
            </div>
          </div>

          {!isLocked && (
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">
                Valoración rápida del criterio
              </div>
              <div className="grid grid-cols-2 gap-2">
                {rubric.levels.map((lvl) => {
                  const isCurrent = critRes?.level.id === lvl.id;
                  const desc = rubric.descriptors?.[`${criterion.id}::${lvl.id}`] ?? '';
                  return (
                    <button
                      key={lvl.id}
                      type="button"
                      onClick={() => {
                        setRubricCriterionForStudents(
                          [student.id],
                          col.id,
                          rubric.id,
                          criterion.id,
                          lvl.id
                        );
                        onShowToast(
                          `C${criterionIndex + 1} → ${lvl.title} (${student.lastName})`
                        );
                        onClose();
                      }}
                      style={{
                        backgroundColor: lvl.color,
                      }}
                      className={`min-h-[48px] px-3 py-2 rounded-xl border text-left transition-all ${
                        isCurrent
                          ? 'border-blue-600 ring-2 ring-blue-500/40 shadow-xs'
                          : 'border-slate-300/80 hover:brightness-97'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {lvl.title}
                        </span>
                        <span className="text-[11px] font-bold text-slate-700 tabular-nums shrink-0">
                          {lvl.percentage}%
                        </span>
                      </div>
                      {desc && (
                        <div className="text-[11px] text-slate-700/85 line-clamp-1 mt-0.5">
                          {desc}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenRubricGrader(student, col);
              }}
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Abrir rúbrica completa</span>
            </button>

            {!isLocked && critRes && (
              <button
                type="button"
                onClick={() => {
                  setRubricCriterionForStudents(
                    [student.id],
                    col.id,
                    rubric.id,
                    criterion.id,
                    null
                  );
                  onShowToast(`C${criterionIndex + 1} borrado`);
                  onClose();
                }}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>Borrar valoración del criterio</span>
              </button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  // target.kind === 'COL'
  const col = target.col;
  const cKey = cellKey(student.id, col.id);
  const cell = activeBook.cells[cKey];
  const grade = cell?.grade ?? null;
  const comment = cell?.comment?.trim() ?? '';
  const isLocked = isTabLocked || Boolean(col.isLocked);
  const edMode = col.editorMode ?? 'STANDARD';
  const isCounterCol =
    col.type === 'NUMERIC' &&
    (edMode === 'COUNTER_POS' || edMode === 'COUNTER_NEG' || edMode === 'QUICK_COUNTER');
  const stepVal =
    typeof col.counterStep === 'number' && col.counterStep > 0 ? col.counterStep : 1;
  const showPct =
    col.type === 'RUBRIC' &&
    Boolean(col.rubricShowPercentage || workspace.settings.showRubricsAsPercent);
  const formattedGrade = formatCellDisplayGrade(grade, col, showPct);
  const outdatedEducamos = isCellOutdatedForEducamos(col, student.id, cell);
  const snappedEducamos = outdatedEducamos ? getEducamosSnappedGrade(col, student.id) : null;

  const colRubric =
    col.type === 'RUBRIC' && col.rubricId
      ? workspace.rubrics.find((r) => r.id === col.rubricId) ?? null
      : null;
  const hasRubricSelections = Boolean(
    cell?.rubricEval && Object.keys(cell.rubricEval.selections ?? {}).length > 0
  );
  const computedRubricScore =
    colRubric && cell?.rubricEval ? computeRubricScore(colRubric, cell.rubricEval) : null;

  const stepCurrentGrade = (delta: number) => {
    if (isLocked || col.type !== 'NUMERIC') return;
    const nextGrade = applyCounterDelta(grade, delta, col);
    setCellData(student.id, col.id, nextGrade, cell?.comment ?? '');
    onShowToast(
      `${student.lastName}: ${nextGrade !== null ? formatGrade(nextGrade, col.decimals) : '—'}`
    );
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Acciones rápidas"
      subtitle={`${studentName} · ${col.title}`}
      maxWidthClass="max-w-md"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {col.type === 'RUBRIC'
                ? 'Rúbrica'
                : col.type === 'AVERAGE'
                  ? 'Columna calculada'
                  : edMode === 'COUNTER_POS'
                    ? 'Contador positivo'
                    : edMode === 'COUNTER_NEG'
                      ? 'Contador negativo'
                      : edMode === 'QUICK_COUNTER'
                        ? 'Contador rápido'
                        : 'Nota / celda'}
            </div>
            <div className="text-sm font-bold text-slate-900 truncate">{col.title}</div>
            {cell?.manualOverride && col.type === 'RUBRIC' && (
              <div className="text-xs font-semibold text-amber-700 mt-0.5">
                Nota modificada manualmente
                {computedRubricScore !== null
                  ? ` (rúbrica: ${formatCellDisplayGrade(computedRubricScore, col, showPct)})`
                  : ''}
              </div>
            )}
            {outdatedEducamos && (
              <div className="text-xs font-semibold text-orange-700 mt-0.5">
                Pendiente en Educamos (antes:{' '}
                {snappedEducamos !== null ? formatGrade(snappedEducamos, col.decimals) : '—'})
              </div>
            )}
            {comment && (
              <div className="text-xs text-slate-600 mt-1 line-clamp-2">Texto: {comment}</div>
            )}
          </div>
          <div className="shrink-0 min-w-[56px] px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-center">
            <div className="text-lg font-extrabold tabular-nums text-slate-900">
              {formattedGrade || '—'}
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          {/* Quick +/- counter actions (especially subtracting on positive counters & vice versa) */}
          {!isLocked && isCounterCol && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => stepCurrentGrade(-stepVal)}
                className="min-h-[48px] px-3 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Minus className="w-4 h-4" />
                <span>Restar {formatGrade(stepVal, col.decimals)}</span>
              </button>
              <button
                type="button"
                onClick={() => stepCurrentGrade(stepVal)}
                className="min-h-[48px] px-3 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Sumar {formatGrade(stepVal, col.decimals)}</span>
              </button>
            </div>
          )}

          {!isLocked && col.type === 'NUMERIC' && edMode === 'QUICK_COUNTER' && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenQuickCounter(col.id);
              }}
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Calculator className="w-4 h-4" />
              <span>Abrir contador rápido</span>
            </button>
          )}

          {/* Rubric quick actions */}
          {col.type === 'RUBRIC' && (
            <>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRubricGrader(student, col);
                }}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <LayoutGrid className="w-4 h-4" />
                <span>Evaluar con rúbrica</span>
              </button>

              {!isLocked && cell?.manualOverride && (
                <button
                  type="button"
                  onClick={() => {
                    if (hasRubricSelections && cell?.rubricEval) {
                      setCellRubricEval(student.id, col.id, cell.rubricEval, undefined, false);
                      onShowToast('Nota calculada de la rúbrica restituida');
                    } else {
                      clearCell(student.id, col.id);
                      onShowToast('Nota manual borrada');
                    }
                    onClose();
                  }}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <RotateCcw className="w-4 h-4 text-amber-700" />
                  <span>
                    Restituir cálculo de rúbrica
                    {computedRubricScore !== null
                      ? ` (${formatCellDisplayGrade(computedRubricScore, col, showPct)})`
                      : ''}
                  </span>
                </button>
              )}

              {colRubric && colRubric.criteria.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    toggleColumnRubricExpanded(col.id);
                    onClose();
                  }}
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <Columns3 className="w-4 h-4 text-purple-600" />
                  <span>
                    {col.rubricExpanded
                      ? 'Ocultar subcolumnas de criterios'
                      : 'Desplegar criterios en subcolumnas'}
                  </span>
                </button>
              )}
            </>
          )}

          {/* Calculated Average column quick actions */}
          {col.type === 'AVERAGE' && (
            <>
              <button
                type="button"
                onClick={() => {
                  recalculateActiveBook();
                  onShowToast(
                    `Nota calculada actualizada${formattedGrade ? ` (${formattedGrade})` : ''}`
                  );
                  onClose();
                }}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Actualizar nota calculada</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditColumn(col);
                }}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Settings2 className="w-4 h-4 text-slate-600" />
                <span>Configurar fórmula / columna</span>
              </button>
            </>
          )}

          {/* Standard numeric quick adjustments & 0 NP */}
          {!isLocked && col.type === 'NUMERIC' && edMode === 'STANDARD' && (
            <div className="grid grid-cols-4 gap-1.5">
              {[-1, -0.5, 0.5, 1].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  onClick={() => stepCurrentGrade(delta)}
                  className={`min-h-[40px] px-2 py-1.5 rounded-xl border text-xs font-bold tabular-nums transition-colors ${
                    delta < 0
                      ? 'bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-800'
                      : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-800'
                  }`}
                >
                  {delta > 0 ? `+${String(delta).replace('.', ',')}` : String(delta).replace('.', ',')}
                </button>
              ))}
            </div>
          )}

          {/* Edit with full keyboard modal + 0 NP quick mark */}
          {!isLocked && col.type !== 'AVERAGE' && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditCell(student, col);
                }}
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Pencil className="w-4 h-4 text-blue-600" />
                <span>
                  {col.type === 'RUBRIC' ? 'Editar nota manual' : 'Editar nota / texto'}
                </span>
              </button>

              {col.type === 'NUMERIC' ? (
                <button
                  type="button"
                  onClick={() => {
                    setCellData(student.id, col.id, 0, 'NP');
                    onShowToast(`${student.lastName}: 0 (NP)`);
                    onClose();
                  }}
                  className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <FileX2 className="w-4 h-4 text-slate-600" />
                  <span>Poner 0 · NP</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    recalculateActiveBook();
                    onShowToast('Nota calculada actualizada');
                    onClose();
                  }}
                  className="min-h-[44px] px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4 text-indigo-600" />
                  <span>Actualizar cálculo</span>
                </button>
              )}
            </div>
          )}

          {outdatedEducamos && (
            <button
              type="button"
              onClick={() => {
                markCellEducamosUpdated(student.id, col.id);
                onShowToast('Celda marcada como actualizada en Educamos');
                onClose();
              }}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-900 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Check className="w-4 h-4 text-orange-600" />
              <span>Marcar actualizada en Educamos</span>
            </button>
          )}

          {(formattedGrade || (!isLocked && col.type !== 'AVERAGE' && (grade !== null || comment || hasRubricSelections))) && (
            <div className="flex items-center gap-2 pt-1">
              {formattedGrade && (
                <button
                  type="button"
                  onClick={() => copyGradeValue(formattedGrade)}
                  className="flex-1 min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar nota</span>
                </button>
              )}
              {!isLocked &&
                col.type !== 'AVERAGE' &&
                (grade !== null || comment || hasRubricSelections) && (
                  <button
                    type="button"
                    onClick={() => {
                      clearCell(student.id, col.id);
                      onShowToast('Celda borrada');
                      onClose();
                    }}
                    className="flex-1 min-h-[42px] px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Borrar celda</span>
                  </button>
                )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
