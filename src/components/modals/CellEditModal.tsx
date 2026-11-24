import React, { useEffect, useRef, useState } from 'react';
import { Check, Delete, Eraser, Keyboard, Minus, Plus, RotateCcw } from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { getEducamosSnappedGrade, isCellOutdatedForEducamos } from '../../engine/educamos';
import {
  applyCounterDelta,
  clampGradeForColumn,
  computeFolderFormulaValue,
  formatGrade,
} from '../../engine/gradeMath';
import { useDeviceProfile } from '../../hooks/useDeviceProfile';
import { cellKey, type ColumnEntity, type StudentEntity } from '../../types/gradebook';
import { Modal } from '../common/Modal';

interface CellEditModalProps {
  open: boolean;
  onClose: () => void;
  student: StudentEntity | null;
  column: ColumnEntity | null;
}

export const CellEditModal: React.FC<CellEditModalProps> = ({
  open,
  onClose,
  student,
  column,
}) => {
  const device = useDeviceProfile();
  const {
    activeBook,
    setCellData,
    clearCell,
    markCellEducamosUpdated,
    restoreFolderCellCalculation,
  } = useGradebook();
  const [gradeStr, setGradeStr] = useState('');
  const [comment, setComment] = useState('');
  const [replaceOnFirstKey, setReplaceOnFirstKey] = useState(false);
  const [showTouchKeyboard, setShowTouchKeyboard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open || !student || !column || !activeBook) return;
    const cell = activeBook.cells[cellKey(student.id, column.id)];
    const hasGrade = cell?.grade !== null && cell?.grade !== undefined;
    setGradeStr(hasGrade ? String(cell.grade).replace('.', ',') : '');
    setComment(cell?.comment ?? '');
    setReplaceOnFirstKey(hasGrade);
    setShowTouchKeyboard(false);
  }, [open, student, column, activeBook]);

  const focusDesktopInput = () => {
    if (!device.isTouch || showTouchKeyboard) {
      inputRef.current?.focus();
    }
  };

  const latestKeyboardHandlersRef = useRef({
    digit: (_d: string) => {},
    decimal: () => {},
    backspace: () => {},
    toggleSign: () => {},
    save: () => {},
  });

  useEffect(() => {
    if (!open || !student || !column) return;

    const routeCharToComment = (ch: string) => {
      const textarea = commentRef.current;
      if (!textarea) return;
      textarea.focus();
      setComment((prev) => {
        if (ch === ' ' && (!prev || prev.endsWith(' '))) return prev;
        const needsSpace =
          prev.length > 0 &&
          !prev.endsWith(' ') &&
          !prev.endsWith('\n') &&
          ch !== ' ' &&
          !/^[,.;:!?)]$/.test(ch);
        return needsSpace ? `${prev} ${ch}` : `${prev}${ch}`;
      });
      requestAnimationFrame(() => {
        const len = textarea.value.length;
        try {
          textarea.setSelectionRange(len, len);
        } catch {
          // ignore
        }
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
      const dialogEl = formRef.current?.closest('dialog');
      if (!dialogEl) return;
      const isModal = dialogEl.matches(':modal');
      const active = document.activeElement;
      // When docked non-modal on the right, only capture keys if focus is inside this dialog
      if (!isModal && !dialogEl.contains(active)) return;

      // If comment textarea is already focused, let it handle all keys natively
      if (active === commentRef.current) return;

      const gradeInputActive =
        active === inputRef.current && !(device.isTouch && !showTouchKeyboard);

      if (gradeInputActive) {
        if (e.key === ' ' || (e.key.length === 1 && !/^[0-9.,+\-]$/.test(e.key))) {
          e.preventDefault();
          routeCharToComment(e.key);
        }
        return;
      }

      // Neither input is actively taking text (focus is on dialog, button, or readOnly touch input)
      if (e.key === 'Enter') {
        if (active?.tagName === 'BUTTON') return;
        e.preventDefault();
        latestKeyboardHandlersRef.current.save();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        latestKeyboardHandlersRef.current.backspace();
      } else if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        latestKeyboardHandlersRef.current.digit(e.key);
      } else if (e.key === ',' || e.key === '.') {
        e.preventDefault();
        latestKeyboardHandlersRef.current.decimal();
      } else if (e.key === '-' && column.minValue < 0) {
        e.preventDefault();
        latestKeyboardHandlersRef.current.toggleSign();
      } else if (e.key === ' ' || (e.key.length === 1 && !/^[0-9.,+\-]$/.test(e.key))) {
        e.preventDefault();
        routeCharToComment(e.key);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, student, column, device.isTouch, showTouchKeyboard]);

  if (!student || !column) return null;

  const currentCell = activeBook?.cells[cellKey(student.id, column.id)];
  const currentNumericGrade =
    currentCell?.grade !== null && currentCell?.grade !== undefined && !Number.isNaN(currentCell.grade)
      ? currentCell.grade
      : null;
  const pendingDelta =
    typeof currentCell?.pendingAdjustment === 'number' &&
    Number.isFinite(currentCell.pendingAdjustment) &&
    currentCell.pendingAdjustment !== 0
      ? currentCell.pendingAdjustment
      : 0;

  const editorMode = column.editorMode ?? 'STANDARD';
  const counterStep = Math.abs(column.counterStep ?? 1) || 1;
  const formattedStep = String(counterStep).replace('.', ',');
  const maxStr = String(column.maxValue).replace('.', ',');

  const parseGradeInput = (raw: string): number | null => {
    const trimmed = raw.trim().toUpperCase();
    if (!trimmed || trimmed === 'NP') return null;
    const cleaned = trimmed.replace(',', '.');
    const parsedNum = Number(cleaned);
    if (Number.isNaN(parsedNum)) return null;
    return clampGradeForColumn(parsedNum, column);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const validGrade = parseGradeInput(gradeStr);
    setCellData(student.id, column.id, validGrade, comment);
    onClose();
  };

  latestKeyboardHandlersRef.current = {
    digit: (d: string) => handleKeypadDigit(d),
    decimal: () => handleKeypadDecimal(),
    backspace: () => handleKeypadBackspace(),
    toggleSign: () => handleKeypadToggleSign(),
    save: () => {
      const validGrade = parseGradeInput(gradeStr);
      setCellData(student.id, column.id, validGrade, comment);
      onClose();
    },
  };

  const applyOneClickDelta = (delta: number) => {
    const base = parseGradeInput(gradeStr) ?? currentNumericGrade;
    const nextGrade = applyCounterDelta(base, delta, column);
    setCellData(student.id, column.id, nextGrade, comment);
    onClose();
  };

  const handleKeypadDigit = (digit: string) => {
    setReplaceOnFirstKey(false);
    setGradeStr((prev) => {
      const base = replaceOnFirstKey || prev === 'NP' ? '' : prev;
      if (base === '0' && digit !== ',') return digit;
      return base + digit;
    });
    focusDesktopInput();
  };

  const handleKeypadDecimal = () => {
    setReplaceOnFirstKey(false);
    setGradeStr((prev) => {
      const base = replaceOnFirstKey || prev === 'NP' ? '' : prev;
      if (base.includes(',') || base.includes('.')) return base;
      return base === '' || base === '-' ? `${base}0,` : `${base},`;
    });
    focusDesktopInput();
  };

  const handleKeypadBackspace = () => {
    setReplaceOnFirstKey(false);
    setGradeStr((prev) => (prev === 'NP' ? '' : prev.slice(0, -1)));
    focusDesktopInput();
  };

  const handleKeypadClear = () => {
    setReplaceOnFirstKey(false);
    setGradeStr('');
    focusDesktopInput();
  };

  const handleKeypadNP = () => {
    setReplaceOnFirstKey(true);
    setGradeStr('NP');
    focusDesktopInput();
  };

  const handleKeypadToggleSign = () => {
    setReplaceOnFirstKey(false);
    setGradeStr((prev) => {
      if (!prev || prev === 'NP') return column.minValue < 0 ? '-' : prev;
      if (prev.startsWith('-')) return prev.slice(1);
      return `-${prev}`;
    });
    focusDesktopInput();
  };

  const handleKeypadMax = () => {
    setReplaceOnFirstKey(true);
    setGradeStr(maxStr);
    focusDesktopInput();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${student.lastName}, ${student.firstName}`}
      subtitle={`Columna: ${column.title} (${column.minValue}–${column.maxValue})`}
      maxWidthClass="w-[min(430px,95vw)]"
    >
      <form ref={formRef} onSubmit={handleSave} className="p-4 space-y-3.5 text-xs">
        {pendingDelta !== 0 && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-950">
            <div className="min-w-0">
              <div className="font-bold text-[11px]">
                Ajuste pendiente: {pendingDelta > 0 ? '+' : ''}
                {String(pendingDelta).replace('.', ',')} pt
              </div>
              <div className="text-[11px] text-amber-800">
                {(() => {
                  const previewInput = parseGradeInput(gradeStr);
                  if (previewInput !== null) {
                    const finalPreview = applyCounterDelta(previewInput, pendingDelta, column);
                    return `Al guardar ${String(previewInput).replace('.', ',')} se aplicará automáticamente → ${String(finalPreview).replace('.', ',')}`;
                  }
                  return 'Se aplicará automáticamente en cuanto guardes una nota numérica o evalúes la rúbrica.';
                })()}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setCellData(student.id, column.id, currentNumericGrade, comment, {
                  clearPendingAdjustment: true,
                });
              }}
              className="shrink-0 px-2 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-[11px] font-semibold text-amber-900"
            >
              Quitar
            </button>
          </div>
        )}

        {/* Counter quick actions (1-click opposite operation + standard step) */}
        {(editorMode === 'COUNTER_POS' ||
          editorMode === 'COUNTER_NEG' ||
          editorMode === 'QUICK_COUNTER') && (
          <div className="p-2.5 rounded-2xl border border-slate-200 bg-slate-50/90 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
              <span>
                {editorMode === 'COUNTER_POS'
                  ? `Contador positivo (+${formattedStep} con doble clic)`
                  : editorMode === 'COUNTER_NEG'
                    ? `Contador negativo (−${formattedStep} con doble clic)`
                    : `Contador rápido (±${formattedStep})`}
              </span>
              <span className="tabular-nums text-slate-500">
                Actual: {currentNumericGrade !== null ? currentNumericGrade : '—'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {editorMode === 'COUNTER_POS' ? (
                <>
                  <button
                    type="button"
                    data-counter-inverse-btn="minus"
                    onClick={() => applyOneClickDelta(-counterStep)}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-2xs transition-colors"
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Restar {formattedStep} (opuesto)</span>
                  </button>
                  <button
                    type="button"
                    data-counter-step-btn="plus"
                    onClick={() => applyOneClickDelta(counterStep)}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Sumar {formattedStep}</span>
                  </button>
                </>
              ) : editorMode === 'COUNTER_NEG' ? (
                <>
                  <button
                    type="button"
                    data-counter-inverse-btn="plus"
                    onClick={() => applyOneClickDelta(counterStep)}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-2xs transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Sumar {formattedStep} (opuesto)</span>
                  </button>
                  <button
                    type="button"
                    data-counter-step-btn="minus"
                    onClick={() => applyOneClickDelta(-counterStep)}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 font-semibold transition-colors"
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Restar {formattedStep}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    data-counter-step-btn="minus"
                    onClick={() => applyOneClickDelta(-counterStep)}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold transition-colors"
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Restar {formattedStep}</span>
                  </button>
                  <button
                    type="button"
                    data-counter-step-btn="plus"
                    onClick={() => applyOneClickDelta(counterStep)}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Sumar {formattedStep}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Grade display input + Calculator Keypad */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="cell-edit-grade-input"
              className="font-semibold text-slate-700"
            >
              Nota numérica ({column.minValue} a {column.maxValue})
            </label>
            {device.isTouch ? (
              <button
                type="button"
                onClick={() => {
                  const next = !showTouchKeyboard;
                  setShowTouchKeyboard(next);
                  if (next) {
                    window.setTimeout(() => inputRef.current?.focus(), 20);
                  } else {
                    inputRef.current?.blur();
                  }
                }}
                aria-pressed={showTouchKeyboard}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                  showTouchKeyboard
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                <Keyboard className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{showTouchKeyboard ? 'Ocultar teclado' : 'Teclado'}</span>
              </button>
            ) : (
              <span className="text-[11px] text-slate-400">
                {column.decimals} decimales · teclado o keypad
              </span>
            )}
          </div>

          <input
            ref={inputRef}
            id="cell-edit-grade-input"
            type="text"
            inputMode={device.isTouch && !showTouchKeyboard ? 'none' : 'decimal'}
            readOnly={device.isTouch && !showTouchKeyboard}
            autoFocus={!device.isTouch}
            value={gradeStr}
            onChange={(e) => {
              setReplaceOnFirstKey(false);
              setGradeStr(e.target.value);
            }}
            placeholder="—"
            className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xl font-bold tabular-nums text-right bg-slate-50/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-slate-900"
          />

          <div
            role="group"
            aria-label="Teclado numérico de calculadora"
            className={`grid grid-cols-4 ${device.isTouch ? 'gap-2' : 'gap-1.5'} select-none`}
            data-cell-keypad="true"
          >
            {['7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                data-keypad-key={d}
                onClick={() => handleKeypadDigit(d)}
                className={`${device.isTouch ? 'h-12 text-base' : 'h-10 text-sm'} rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] font-bold text-slate-800 tabular-nums transition-all shadow-2xs`}
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              data-keypad-key="backspace"
              onClick={handleKeypadBackspace}
              aria-label="Borrar último dígito"
              title="Borrar último dígito"
              className={`${device.isTouch ? 'h-12' : 'h-10'} rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 active:scale-[0.98] text-amber-800 font-bold flex items-center justify-center transition-all`}
            >
              <Delete className="w-4 h-4" aria-hidden="true" />
            </button>

            {['4', '5', '6'].map((d) => (
              <button
                key={d}
                type="button"
                data-keypad-key={d}
                onClick={() => handleKeypadDigit(d)}
                className={`${device.isTouch ? 'h-12 text-base' : 'h-10 text-sm'} rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] font-bold text-slate-800 tabular-nums transition-all shadow-2xs`}
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              data-keypad-key="clear"
              onClick={handleKeypadClear}
              title="Limpiar valor"
              className={`${device.isTouch ? 'h-12 text-sm' : 'h-10 text-xs'} rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] font-bold text-slate-700 transition-all`}
            >
              C
            </button>

            {['1', '2', '3'].map((d) => (
              <button
                key={d}
                type="button"
                data-keypad-key={d}
                onClick={() => handleKeypadDigit(d)}
                className={`${device.isTouch ? 'h-12 text-base' : 'h-10 text-sm'} rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] font-bold text-slate-800 tabular-nums transition-all shadow-2xs`}
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              data-keypad-key="np"
              onClick={handleKeypadNP}
              title="No presentado / sin calificar"
              className={`${device.isTouch ? 'h-12 text-sm' : 'h-10 text-xs'} rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] font-bold text-slate-600 transition-all`}
            >
              NP
            </button>

            <button
              type="button"
              data-keypad-key="0"
              onClick={() => handleKeypadDigit('0')}
              className={`${device.isTouch ? 'h-12 text-base' : 'h-10 text-sm'} rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] font-bold text-slate-800 tabular-nums transition-all shadow-2xs`}
            >
              0
            </button>
            <button
              type="button"
              data-keypad-key=","
              onClick={handleKeypadDecimal}
              aria-label="Coma decimal"
              className={`${device.isTouch ? 'h-12 text-lg' : 'h-10 text-base'} rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] font-bold text-slate-800 transition-all shadow-2xs`}
            >
              ,
            </button>
            {column.minValue < 0 ? (
              <button
                type="button"
                data-keypad-key="sign"
                onClick={handleKeypadToggleSign}
                title="Cambiar signo (+/-)"
                className={`${device.isTouch ? 'h-12 text-base' : 'h-10 text-sm'} rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] font-bold text-slate-700 transition-all`}
              >
                ±
              </button>
            ) : (
              <button
                type="button"
                data-keypad-key="max"
                onClick={handleKeypadMax}
                title={`Poner nota máxima (${maxStr})`}
                className={`${device.isTouch ? 'h-12 text-sm' : 'h-10 text-xs'} rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 active:scale-[0.98] font-bold text-blue-700 tabular-nums transition-all`}
              >
                {maxStr}
              </button>
            )}
            <button
              type="submit"
              data-keypad-key="ok"
              className={`${device.isTouch ? 'h-12 text-sm' : 'h-10 text-xs'} rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold flex items-center justify-center gap-1 transition-all shadow-2xs`}
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>OK</span>
            </button>
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Anotación / Comentario (solo visual, no afecta a los cálculos)
          </label>
          <textarea
            ref={commentRef}
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Añade cualquier observación sobre esta entrega o prueba..."
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {(() => {
          const folderEntry = activeBook?.tabs
            .map((t) => ({
              tab: t,
              folder: t.folders.find((f) => f.id === column.id),
            }))
            .find((x) => Boolean(x.folder));
          if (!folderEntry?.folder || !activeBook) return null;
          const childCols = folderEntry.tab.columns
            .filter((c) => c.folderId === folderEntry.folder!.id)
            .sort((a, b) => a.orderIndex - b.orderIndex);
          const formulaVal = computeFolderFormulaValue(
            folderEntry.folder,
            childCols,
            student.id,
            activeBook
          );
          const formulaLabel = formulaVal !== null ? formatGrade(formulaVal, 2) : '—';
          if (!currentCell?.manualOverride && !currentCell?.autoRecalcNotice) {
            return (
              <div className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-600">
                Carpeta calculada automáticamente (valor actual: <strong className="tabular-nums text-slate-800">{formulaLabel}</strong>). Si escribes una nota, sustituirá el cálculo hasta que cambie una tarea de la carpeta o lo restituyas.
              </div>
            );
          }
          return (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-950">
              <div className="min-w-0">
                <div className="font-bold text-[11px]">
                  {currentCell.manualOverride
                    ? 'Nota de carpeta editada manualmente'
                    : 'Recalculada automáticamente tras cambiar una tarea'}
                </div>
                <div className="text-[11px] text-amber-800 tabular-nums">
                  Cálculo automático de la carpeta: <span className="font-semibold">{formulaLabel}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  restoreFolderCellCalculation(student.id, column.id);
                  onClose();
                }}
                className="shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold flex items-center gap-1 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{currentCell.manualOverride ? 'Restituir cálculo' : 'Quitar aviso'}</span>
              </button>
            </div>
          );
        })()}

        {(() => {
          const educamosCell = activeBook ? activeBook.cells[cellKey(student.id, column.id)] : undefined;
          if (!isCellOutdatedForEducamos(column, student.id, educamosCell)) return null;
          const prevEducamos = getEducamosSnappedGrade(column, student.id);
          const prevLabel = prevEducamos !== null ? formatGrade(prevEducamos, column.decimals) : '—';
          const currLabel =
            educamosCell?.grade !== null && educamosCell?.grade !== undefined
              ? formatGrade(educamosCell.grade, column.decimals)
              : '—';
          return (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-orange-200 bg-orange-50 text-orange-950">
              <div className="min-w-0">
                <div className="font-bold text-[11px]">Cambiada desde Educamos</div>
                <div className="text-[11px] text-orange-800 tabular-nums">
                  En Educamos: <span className="font-semibold">{prevLabel}</span> → Actual:{' '}
                  <span className="font-semibold">{currLabel}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => markCellEducamosUpdated(student.id, column.id)}
                className="shrink-0 px-2.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-bold flex items-center gap-1 transition-colors"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Marcar actualizada</span>
              </button>
            </div>
          );
        })()}

        <div className="flex items-center justify-between pt-2.5 border-t border-slate-200">
          <button
            type="button"
            onClick={() => {
              clearCell(student.id, column.id);
              onClose();
            }}
            className="px-3 py-1.5 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-1.5"
          >
            <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Vaciar celda</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Guardar</span>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
