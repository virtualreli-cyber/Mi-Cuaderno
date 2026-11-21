import React, { useEffect, useRef, useState } from 'react';
import { Check, Delete, Eraser, Minus, Plus } from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { applyCounterDelta, clampGradeForColumn } from '../../engine/gradeMath';
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
  const { activeBook, setCellData, clearCell } = useGradebook();
  const [gradeStr, setGradeStr] = useState('');
  const [comment, setComment] = useState('');
  const [replaceOnFirstKey, setReplaceOnFirstKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !student || !column || !activeBook) return;
    const cell = activeBook.cells[cellKey(student.id, column.id)];
    const hasGrade = cell?.grade !== null && cell?.grade !== undefined;
    setGradeStr(hasGrade ? String(cell.grade).replace('.', ',') : '');
    setComment(cell?.comment ?? '');
    setReplaceOnFirstKey(hasGrade);
  }, [open, student, column, activeBook]);

  if (!student || !column) return null;

  const currentCell = activeBook?.cells[cellKey(student.id, column.id)];
  const currentNumericGrade =
    currentCell?.grade !== null && currentCell?.grade !== undefined && !Number.isNaN(currentCell.grade)
      ? currentCell.grade
      : null;

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
    inputRef.current?.focus();
  };

  const handleKeypadDecimal = () => {
    setReplaceOnFirstKey(false);
    setGradeStr((prev) => {
      const base = replaceOnFirstKey || prev === 'NP' ? '' : prev;
      if (base.includes(',') || base.includes('.')) return base;
      return base === '' || base === '-' ? `${base}0,` : `${base},`;
    });
    inputRef.current?.focus();
  };

  const handleKeypadBackspace = () => {
    setReplaceOnFirstKey(false);
    setGradeStr((prev) => (prev === 'NP' ? '' : prev.slice(0, -1)));
    inputRef.current?.focus();
  };

  const handleKeypadClear = () => {
    setReplaceOnFirstKey(false);
    setGradeStr('');
    inputRef.current?.focus();
  };

  const handleKeypadNP = () => {
    setReplaceOnFirstKey(true);
    setGradeStr('NP');
    inputRef.current?.focus();
  };

  const handleKeypadToggleSign = () => {
    setReplaceOnFirstKey(false);
    setGradeStr((prev) => {
      if (!prev || prev === 'NP') return column.minValue < 0 ? '-' : prev;
      if (prev.startsWith('-')) return prev.slice(1);
      return `-${prev}`;
    });
    inputRef.current?.focus();
  };

  const handleKeypadMax = () => {
    setReplaceOnFirstKey(true);
    setGradeStr(maxStr);
    inputRef.current?.focus();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${student.lastName}, ${student.firstName}`}
      subtitle={`Columna: ${column.title} (${column.minValue}–${column.maxValue})`}
      maxWidthClass="w-[min(430px,95vw)]"
    >
      <form onSubmit={handleSave} className="p-4 space-y-3.5 text-xs">
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
          <div className="flex items-center justify-between">
            <label
              htmlFor="cell-edit-grade-input"
              className="font-semibold text-slate-700"
            >
              Nota numérica ({column.minValue} a {column.maxValue})
            </label>
            <span className="text-[11px] text-slate-400">
              {column.decimals} decimales · teclado o keypad
            </span>
          </div>

          <input
            ref={inputRef}
            id="cell-edit-grade-input"
            type="text"
            inputMode="decimal"
            autoFocus
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
            className="grid grid-cols-4 gap-1.5 select-none"
            data-cell-keypad="true"
          >
            {['7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                data-keypad-key={d}
                onClick={() => handleKeypadDigit(d)}
                className="h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] text-sm font-bold text-slate-800 tabular-nums transition-all shadow-2xs"
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
              className="h-10 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 active:scale-[0.98] text-amber-800 font-bold flex items-center justify-center transition-all"
            >
              <Delete className="w-4 h-4" aria-hidden="true" />
            </button>

            {['4', '5', '6'].map((d) => (
              <button
                key={d}
                type="button"
                data-keypad-key={d}
                onClick={() => handleKeypadDigit(d)}
                className="h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] text-sm font-bold text-slate-800 tabular-nums transition-all shadow-2xs"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              data-keypad-key="clear"
              onClick={handleKeypadClear}
              title="Limpiar valor"
              className="h-10 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-xs font-bold text-slate-700 transition-all"
            >
              C
            </button>

            {['1', '2', '3'].map((d) => (
              <button
                key={d}
                type="button"
                data-keypad-key={d}
                onClick={() => handleKeypadDigit(d)}
                className="h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] text-sm font-bold text-slate-800 tabular-nums transition-all shadow-2xs"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              data-keypad-key="np"
              onClick={handleKeypadNP}
              title="No presentado / sin calificar"
              className="h-10 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-xs font-bold text-slate-600 transition-all"
            >
              NP
            </button>

            <button
              type="button"
              data-keypad-key="0"
              onClick={() => handleKeypadDigit('0')}
              className="h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] text-sm font-bold text-slate-800 tabular-nums transition-all shadow-2xs"
            >
              0
            </button>
            <button
              type="button"
              data-keypad-key=","
              onClick={handleKeypadDecimal}
              aria-label="Coma decimal"
              className="h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-[0.98] text-base font-bold text-slate-800 transition-all shadow-2xs"
            >
              ,
            </button>
            {column.minValue < 0 ? (
              <button
                type="button"
                data-keypad-key="sign"
                onClick={handleKeypadToggleSign}
                title="Cambiar signo (+/-)"
                className="h-10 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-sm font-bold text-slate-700 transition-all"
              >
                ±
              </button>
            ) : (
              <button
                type="button"
                data-keypad-key="max"
                onClick={handleKeypadMax}
                title={`Poner nota máxima (${maxStr})`}
                className="h-10 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 active:scale-[0.98] text-xs font-bold text-blue-700 tabular-nums transition-all"
              >
                {maxStr}
              </button>
            )}
            <button
              type="submit"
              data-keypad-key="ok"
              className="h-10 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1 transition-all shadow-2xs"
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
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Añade cualquier observación sobre esta entrega o prueba..."
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

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
