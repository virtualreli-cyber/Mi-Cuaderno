import React, { useEffect, useState } from 'react';
import { Check, Copy, FolderPlus, Trash2 } from 'lucide-react';
import { CLASS_ACCENT_SWATCHES, SCHOOL_DEFAULT_COLORS } from '../../constants/colors';
import { useGradebook } from '../../context/GradebookContext';
import { useDeviceProfile } from '../../hooks/useDeviceProfile';
import type { ClassBook } from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { NumericInput } from '../common/NumericInput';

interface BookModalProps {
  open: boolean;
  onClose: () => void;
  kind: 'CLASS' | 'TEMPLATE';
  editingBook: ClassBook | null;
}

export const BookModal: React.FC<BookModalProps> = ({
  open,
  onClose,
  kind,
  editingBook,
}) => {
  const device = useDeviceProfile();
  const { createBook, updateBook, deleteBook, saveBookAsTemplate, workspace } = useGradebook();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [school, setSchool] = useState('Ribarroja');
  const [tutor, setTutor] = useState('');
  const [year, setYear] = useState('2026-2027');
  const [color, setColor] = useState(SCHOOL_DEFAULT_COLORS.Ribarroja);
  const [passThreshold, setPassThreshold] = useState(5);

  useEffect(() => {
    if (!open) return;
    if (editingBook) {
      setName(editingBook.name);
      setSubject(editingBook.subject);
      setSchool(editingBook.school ?? '');
      setTutor(editingBook.tutor ?? '');
      setYear(editingBook.year);
      setColor(editingBook.color);
      setPassThreshold(editingBook.passThreshold);
    } else {
      setName('');
      setSubject('Religión');
      setSchool(kind === 'CLASS' ? 'Ribarroja' : '');
      setTutor('');
      setYear(kind === 'TEMPLATE' ? 'Plantilla' : '2026-2027');
      setColor(kind === 'CLASS' ? SCHOOL_DEFAULT_COLORS.Ribarroja : CLASS_ACCENT_SWATCHES[2]);
      setPassThreshold(5);
    }
  }, [open, editingBook, kind]);

  const handleSchoolChange = (nextSchool: string) => {
    setSchool(nextSchool);
    if (!editingBook && SCHOOL_DEFAULT_COLORS[nextSchool]) {
      setColor(SCHOOL_DEFAULT_COLORS[nextSchool]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (editingBook) {
      updateBook(editingBook.id, {
        name: name.trim(),
        subject: subject.trim(),
        school: !editingBook.isTemplate ? (school.trim() || undefined) : undefined,
        tutor: !editingBook.isTemplate ? (tutor.trim() || undefined) : undefined,
        year: year.trim(),
        color,
        passThreshold,
      });
    } else {
      createBook(kind, {
        name: name.trim(),
        subject: subject.trim(),
        school: kind === 'CLASS' ? (school.trim() || undefined) : undefined,
        tutor: kind === 'CLASS' ? (tutor.trim() || undefined) : undefined,
        year: year.trim(),
        color,
      });
    }
    onClose();
  };

  const isTpl = editingBook ? Boolean(editingBook.isTemplate) : kind === 'TEMPLATE';
  const canDelete = Boolean(
    editingBook && (isTpl || workspace.classes.length > 1)
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        editingBook
          ? isTpl
            ? `Editar plantilla de clase: ${editingBook.name}`
            : `Editar clase: ${editingBook.name}`
          : isTpl
            ? 'Nueva Plantilla de Clase (Borrador)'
            : 'Nueva Clase'
      }
      subtitle={
        isTpl
          ? 'Clase en borrador desde la que podrás copiar columnas, carpetas o pestañas a tus clases'
          : undefined
      }
      maxWidthClass="w-[min(500px,95vw)]"
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            {isTpl ? 'Nombre de la plantilla' : 'Nombre de la clase'}
          </label>
          <input
            type="text"
            required
            autoFocus={!device.isTouch}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isTpl ? 'Ej: Evaluación Trimestral' : 'Ej: 2.º ESO B'}
            className={`w-full border border-slate-300 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 ${
              device.isTouch ? 'text-base' : 'text-sm'
            }`}
          />
        </div>

        {!isTpl && (
          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">Colegio / Centro</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: 'Ribarroja', label: 'Ribarroja', dot: SCHOOL_DEFAULT_COLORS.Ribarroja, activeCls: 'border-rose-300 bg-rose-50 text-rose-900' },
                { val: 'Manises', label: 'Manises', dot: SCHOOL_DEFAULT_COLORS.Manises, activeCls: 'border-blue-300 bg-blue-50 text-blue-900' },
                { val: '', label: 'Otro / Sin colegio', dot: '#CBD5E1', activeCls: 'border-slate-400 bg-slate-100 text-slate-900' },
              ].map((opt) => (
                <button
                  key={opt.val || 'none'}
                  type="button"
                  onClick={() => handleSchoolChange(opt.val)}
                  className={`py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    school === opt.val
                      ? opt.activeCls
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: opt.dot }}
                  />
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {isTpl ? 'Descripción breve' : 'Asignatura / Subtítulo'}
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ej: Matemáticas"
              className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Curso / Etiqueta</label>
            <input
              type="text"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
            />
          </div>
        </div>

        {!isTpl && (
          <div>
            <label htmlFor="book-tutor-input" className="block font-semibold text-slate-700 mb-1">
              Tutor/a de la clase
            </label>
            <input
              id="book-tutor-input"
              type="text"
              value={tutor}
              onChange={(e) => setTutor(e.target.value)}
              placeholder="Ej: Marta Pérez Capella"
              className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">Color identificador</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {CLASS_ACCENT_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    color === c ? 'border-slate-900 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-7 h-7 rounded-lg border border-slate-300 cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Nota aprobado por defecto</label>
            <NumericInput
              value={passThreshold}
              aria-label="Nota aprobado por defecto"
              onChange={(val) => setPassThreshold(val)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white tabular-nums"
            />
          </div>
        </div>

        {editingBook && !isTpl && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                saveBookAsTemplate(editingBook.id, `Plantilla: ${editingBook.name}`);
                onClose();
              }}
              className="w-full py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold flex items-center justify-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5 text-blue-600" />
              <span>Crear plantilla a partir de esta clase</span>
            </button>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          {canDelete && editingBook ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`¿Eliminar "${editingBook.name}"?`)) {
                  deleteBook(editingBook.id);
                  onClose();
                }
              }}
              className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Eliminar</span>
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 flex items-center gap-1.5"
            >
              {editingBook ? <Check className="w-3.5 h-3.5" /> : <FolderPlus className="w-3.5 h-3.5" />}
              <span>{editingBook ? 'Guardar' : 'Crear'}</span>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
