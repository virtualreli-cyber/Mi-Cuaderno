import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Check, MessageSquarePlus, RotateCcw } from 'lucide-react';
import {
  appendCellComment,
  buildGradeAdjustmentBatch,
  buildRestoreOriginalGradeTargets,
  type CommentAppendSeparator,
} from '../../engine/gradeMath';
import { cellKey, type ClassBook, type ColumnEntity } from '../../types/gradebook';
import { Modal } from '../common/Modal';

export interface BatchAdjustTargetState {
  title: string;
  subtitle: string;
  targets: Array<{ studentId: string; columnId: string }>;
}

interface BatchAdjustGradeModalProps {
  targetState: BatchAdjustTargetState | null;
  book: ClassBook | null;
  columns: ColumnEntity[];
  onClose: () => void;
  onApply: (
    entries: Array<{
      studentId: string;
      columnId: string;
      grade: number | null;
      comment: string;
      pendingAdjustment?: number;
      appliedAdjustment?: number;
      preAdjustmentGrade?: number;
      keepRubricAuto?: boolean;
      hasExplicitPendingAdjustment?: boolean;
    }>
  ) => void;
  onRestoreOriginal?: (targets: Array<{ studentId: string; columnId: string }>) => void;
}

const DELTA_PRESETS = [-2, -1, -0.5, -0.25, 0.25, 0.5, 1, 2];

const COMMENT_SUGGESTIONS = [
  'Buen comportamiento',
  'Buen trabajo',
  'Mal comportamiento',
  'No trabaja',
];

export const BatchAdjustGradeModal: React.FC<BatchAdjustGradeModalProps> = ({
  targetState,
  book,
  columns,
  onClose,
  onApply,
  onRestoreOriginal,
}) => {
  const [deltaDraft, setDeltaDraft] = useState<string>('-1');
  const [comment, setComment] = useState('');
  const [separator, setSeparator] = useState<CommentAppendSeparator>('NEWLINE');
  const [commentError, setCommentError] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const colMap = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  const stats = useMemo(() => {
    if (!targetState || !book) {
      return {
        total: 0,
        gradedCount: 0,
        emptyCount: 0,
        sampleExistingComment: '',
        singleColumn: null as ColumnEntity | null,
        restorableTargets: [] as Array<{ studentId: string; columnId: string }>,
      };
    }

    let gradedCount = 0;
    let emptyCount = 0;
    let sampleExistingComment = '';
    const distinctColIds = new Set<string>();

    for (const { studentId, columnId } of targetState.targets) {
      const col = colMap.get(columnId);
      if (!col || col.isLocked || col.type === 'AVERAGE') continue;
      distinctColIds.add(col.id);
      const cell = book.cells[cellKey(studentId, col.id)];
      const hasGrade =
        cell?.grade !== null && cell?.grade !== undefined && !Number.isNaN(cell.grade);
      if (hasGrade) gradedCount += 1;
      else emptyCount += 1;
      if (!sampleExistingComment && cell?.comment?.trim()) {
        sampleExistingComment = cell.comment.trim();
      }
    }

    const singleColumn =
      distinctColIds.size === 1 ? (colMap.get([...distinctColIds][0]) ?? null) : null;
    const restorableTargets = buildRestoreOriginalGradeTargets(
      book,
      targetState.targets,
      colMap
    );

    return {
      total: gradedCount + emptyCount,
      gradedCount,
      emptyCount,
      sampleExistingComment,
      singleColumn,
      restorableTargets,
    };
  }, [targetState, book, colMap]);

  useEffect(() => {
    if (!targetState) return;
    setDeltaDraft('-1');
    setComment('');
    setSeparator('NEWLINE');
    setCommentError(false);
  }, [targetState]);

  const parsedDelta = useMemo(() => {
    const cleaned = deltaDraft.trim().replace(',', '.');
    if (!cleaned || cleaned === '-' || cleaned === '+') return NaN;
    return Number(cleaned);
  }, [deltaDraft]);

  const isDeltaValid = Number.isFinite(parsedDelta);
  const effectiveDelta = isDeltaValid ? parsedDelta : 0;
  const hasComment = comment.trim().length > 0;

  const previewBatch = useMemo(() => {
    if (!targetState || !book || !isDeltaValid) {
      return { entries: [], adjustedCount: 0, immediateCount: 0, queuedPendingCount: 0 };
    }
    return buildGradeAdjustmentBatch({
      book,
      targets: targetState.targets,
      colMap,
      delta: effectiveDelta,
      comment,
      separator,
    });
  }, [targetState, book, colMap, isDeltaValid, effectiveDelta, comment, separator]);

  const canSubmit = isDeltaValid && previewBatch.adjustedCount > 0 && hasComment;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasComment) {
      setCommentError(true);
      commentRef.current?.focus();
      return;
    }
    if (!canSubmit) return;
    onApply(
      previewBatch.entries.map((entry) => ({
        ...entry,
        hasExplicitPendingAdjustment: true,
      }))
    );
    onClose();
  };

  return (
    <Modal
      open={Boolean(targetState)}
      onClose={onClose}
      title={targetState?.title ?? 'Ajustar notas y comentario'}
      subtitle={targetState?.subtitle}
      maxWidthClass="max-w-md"
    >
      {targetState && (
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {/* 1. Delta adjustment */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="batch-adjust-delta"
                className="font-bold text-slate-800 flex items-center gap-1.5"
              >
                <ArrowDownUp className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                <span>Subir o bajar nota</span>
              </label>
              {stats.singleColumn && (
                <span className="text-[11px] text-slate-500 font-medium tabular-nums">
                  Límites: {stats.singleColumn.minValue} a {stats.singleColumn.maxValue}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                id="batch-adjust-delta"
                type="text"
                inputMode="decimal"
                autoFocus
                value={deltaDraft}
                onChange={(e) => setDeltaDraft(e.target.value)}
                placeholder="Ej: -1 o +0,5"
                className="w-32 border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 tabular-nums text-center bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <span className="text-[11px] font-medium text-slate-600">
                {!isDeltaValid
                  ? 'Introduce un número válido (ej. -1, +0,5)'
                  : effectiveDelta > 0
                    ? `Sumará +${String(effectiveDelta).replace('.', ',')} a cada alumno`
                    : effectiveDelta < 0
                      ? `Restará ${String(Math.abs(effectiveDelta)).replace('.', ',')} a cada alumno`
                      : 'Solo añadirá el comentario (nota sin cambios)'}
              </span>
            </div>

            <div className="flex flex-wrap gap-1">
              {DELTA_PRESETS.map((preset) => {
                const isNeg = preset < 0;
                const isSelected = isDeltaValid && Math.abs(effectiveDelta - preset) < 1e-6;
                const label = `${preset > 0 ? '+' : ''}${String(preset).replace('.', ',')}`;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDeltaDraft(String(preset))}
                    className={`px-2.5 py-1 rounded-lg border font-bold tabular-nums transition-colors ${
                      isSelected
                        ? isNeg
                          ? 'bg-rose-600 border-rose-700 text-white'
                          : 'bg-emerald-600 border-emerald-700 text-white'
                        : isNeg
                          ? 'border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700'
                          : 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Comment (required) + fixed-height box so modal never elongates */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="batch-adjust-comment"
                className="font-bold text-slate-800 flex items-center gap-1.5"
              >
                <MessageSquarePlus className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                <span>Comentario / motivo</span>
              </label>
              <span
                className={`text-[10.5px] font-semibold ${
                  hasComment
                    ? 'text-emerald-700'
                    : commentError
                      ? 'text-rose-600'
                      : 'text-amber-700'
                }`}
              >
                {hasComment ? 'Listo' : 'Obligatorio'}
              </span>
            </div>

            <textarea
              ref={commentRef}
              id="batch-adjust-comment"
              rows={3}
              wrap="soft"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                if (commentError && e.target.value.trim()) {
                  setCommentError(false);
                }
              }}
              placeholder="Ej: Baja 1 punto por mal comportamiento / Sube 0,5 por buen trabajo..."
              className={`w-full h-[76px] border rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 resize-none overflow-y-auto break-words ${
                commentError && !hasComment
                  ? 'border-rose-400 focus:ring-rose-500/30'
                  : 'border-slate-300 focus:ring-blue-500/30'
              }`}
            />

            <div className="flex flex-wrap gap-1">
              {COMMENT_SUGGESTIONS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setComment((prev) =>
                      prev.trim() ? `${prev.trim().replace(/\.$/, '')}. ${chip}` : chip
                    );
                    setCommentError(false);
                  }}
                  className="px-2 py-0.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-medium text-slate-600 transition-colors"
                >
                  + {chip}
                </button>
              ))}
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="text-[11px] font-semibold text-slate-600">
                Si algún alumno ya tenía comentario, añadir después de:
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  data-comment-sep="NEWLINE"
                  onClick={() => setSeparator('NEWLINE')}
                  className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-colors ${
                    separator === 'NEWLINE'
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Punto y aparte (↵)
                </button>
                <button
                  type="button"
                  data-comment-sep="SPACE"
                  onClick={() => setSeparator('SPACE')}
                  className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-colors ${
                    separator === 'SPACE'
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Punto y seguido (. )
                </button>
              </div>

              <div
                data-comment-append-preview="true"
                className="h-12 overflow-y-auto px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 whitespace-pre-wrap break-words"
              >
                {hasComment ? (
                  <>
                    <span className="font-semibold text-slate-500">Vista previa: </span>
                    {appendCellComment(
                      stats.sampleExistingComment || 'Comentario anterior',
                      comment,
                      separator
                    )}
                  </>
                ) : (
                  <span className="text-slate-400">
                    {commentError
                      ? 'Debes escribir un comentario para poder aplicar el cambio.'
                      : separator === 'NEWLINE'
                        ? 'Si ya tenía comentario, se añadirá debajo tras punto y aparte.'
                        : 'Si ya tenía comentario, se añadirá a continuación tras punto y seguido.'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 3. Summary of immediate + queued pending cells */}
          <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-600 space-y-0.5">
            <div>
              Se aplicará a <strong>{stats.total}</strong>{' '}
              {stats.total === 1 ? 'alumno' : 'alumnos'}:{' '}
              <strong>{stats.gradedCount}</strong> con nota inmediata
              {stats.emptyCount > 0 && (
                <>
                  {' '}
                  · <strong>{stats.emptyCount}</strong> sin nota aún (quedará guardado para cuando evalúes)
                </>
              )}
              .
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            {onRestoreOriginal && stats.restorableTargets.length > 0 ? (
              <button
                type="button"
                data-modal-restore-original-btn="true"
                onClick={() => {
                  onRestoreOriginal(stats.restorableTargets);
                  onClose();
                }}
                title="Restaura la nota original previa a las subidas o bajadas"
                className="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Restaurar original ({stats.restorableTargets.length})</span>
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                data-batch-adjust-apply="true"
                disabled={!canSubmit}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  Aplicar a {previewBatch.adjustedCount}{' '}
                  {previewBatch.adjustedCount === 1 ? 'celda' : 'celdas'}
                </span>
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
};
