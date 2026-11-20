import React, { useEffect, useState } from 'react';
import { Check, Eraser } from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { clampGradeForColumn } from '../../engine/gradeMath';
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

  useEffect(() => {
    if (!open || !student || !column || !activeBook) return;
    const cell = activeBook.cells[cellKey(student.id, column.id)];
    setGradeStr(
      cell?.grade !== null && cell?.grade !== undefined ? String(cell.grade) : ''
    );
    setComment(cell?.comment ?? '');
  }, [open, student, column, activeBook]);

  if (!student || !column) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = gradeStr.trim().replace(',', '.');
    const parsedNum = cleaned === '' ? null : Number(cleaned);
    const validGrade =
      parsedNum !== null && !Number.isNaN(parsedNum)
        ? clampGradeForColumn(parsedNum, column)
        : null;
    setCellData(student.id, column.id, validGrade, comment);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${student.firstName} ${student.lastName}`}
      subtitle={`Columna: ${column.title} (${column.minValue}–${column.maxValue})`}
      maxWidthClass="w-[min(460px,95vw)]"
    >
      <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Nota numérica ({column.minValue} a {column.maxValue}, {column.decimals} decimales)
          </label>
          <input
            type="number"
            autoFocus
            step={Math.pow(10, -column.decimals)}
            min={column.minValue}
            max={column.maxValue}
            value={gradeStr}
            onChange={(e) => setGradeStr(e.target.value)}
            placeholder="Dejar vacío si no evaluado"
            className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base font-bold tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Anotación / Comentario (solo visual, no afecta a los cálculos)
          </label>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Añade cualquier observación sobre esta entrega o prueba..."
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={() => {
              clearCell(student.id, column.id);
              onClose();
            }}
            className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-1.5"
          >
            <Eraser className="w-3.5 h-3.5" />
            <span>Vaciar celda</span>
          </button>

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
  );
};
