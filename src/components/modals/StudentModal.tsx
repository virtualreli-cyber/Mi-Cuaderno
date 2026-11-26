import React, { useEffect, useState } from 'react';
import { Ban, Check, Palette, StickyNote, Tag, Trash2, UserPlus, Users, X } from 'lucide-react';
import { STUDENT_ROW_SWATCHES } from '../../constants/colors';
import {
  STUDENT_TAG_CATALOG,
  hasCatalogTag,
  resolveStudentTags,
  toggleCatalogTag,
  type StudentTagId,
} from '../../constants/studentTags';
import { useGradebook } from '../../context/GradebookContext';
import { useDeviceProfile } from '../../hooks/useDeviceProfile';
import { formatGrade, getEffectiveBookGroups, getStudentActiveGroup } from '../../engine/gradeMath';
import { cellKey, type StudentEntity } from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { StudentTagIcon } from '../common/StudentTagIcon';

interface StudentModalProps {
  open: boolean;
  onClose: () => void;
  editingStudent: StudentEntity | null;
  onOpenBulkStudents?: () => void;
}

export const StudentModal: React.FC<StudentModalProps> = ({
  open,
  onClose,
  editingStudent,
  onOpenBulkStudents,
}) => {
  const device = useDeviceProfile();
  const { activeBook, addStudent, updateStudent, deleteStudent } = useGradebook();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [group, setGroup] = useState('');
  const [color, setColor] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editingStudent) {
      setFirstName(editingStudent.firstName);
      setLastName(editingStudent.lastName);
      setGroup(
        activeBook ? (getStudentActiveGroup(editingStudent, activeBook) ?? '') : (editingStudent.group ?? '')
      );
      setColor(editingStudent.color ?? '');
      setTags(editingStudent.tags ?? []);
      setNotes(editingStudent.notes ?? '');
    } else {
      setFirstName('');
      setLastName('');
      setGroup('');
      setColor('');
      setTags([]);
      setNotes('');
    }
  }, [open, editingStudent, activeBook]);

  const handleToggleTag = (tagId: StudentTagId) => {
    setTags((prev) => toggleCatalogTag(prev, tagId));
  };

  const customTags = resolveStudentTags(tags).filter((t) => t.isCustom);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;
    if (editingStudent) {
      updateStudent(editingStudent.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        group: group.trim() || undefined,
        color: color.trim() || undefined,
        tags,
        notes: notes.trim() || undefined,
      });
    } else {
      addStudent({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        group: group.trim() || undefined,
        color: color.trim() || undefined,
        tags,
        notes: notes.trim() || undefined,
      });
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        editingStudent
          ? `${editingStudent.firstName} ${editingStudent.lastName}`
          : 'Nuevo Alumno'
      }
      subtitle={editingStudent ? 'Ficha del alumno y resumen de notas' : 'Añadir estudiante a la clase'}
      maxWidthClass="w-[min(560px,95vw)]"
    >
      <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Nombre</label>
            <input
              type="text"
              required
              autoFocus={!device.isTouch}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Apellidos</label>
            <input
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
            />
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">Grupo / Equipo (opcional)</label>
          <input
            type="text"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Escribe o elige un grupo..."
            className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
          />
          {activeBook && getEffectiveBookGroups(activeBook).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {getEffectiveBookGroups(activeBook).map((grp) => {
                const isSelected = group.trim().toLowerCase() === grp.name.trim().toLowerCase();
                return (
                  <button
                    key={grp.id}
                    type="button"
                    onClick={() => setGroup(isSelected ? '' : grp.name)}
                    style={{ backgroundColor: grp.color }}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold text-slate-800 border transition-all ${
                      isSelected
                        ? 'border-slate-800 ring-2 ring-blue-500/40'
                        : 'border-black/10 opacity-85 hover:opacity-100'
                    }`}
                  >
                    {grp.name}
                  </button>
                );
              })}
              {group.trim() && (
                <button
                  type="button"
                  onClick={() => setGroup('')}
                  className="px-2 py-0.5 rounded-full text-[11px] text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200"
                >
                  Quitar
                </button>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>Color de relleno (marca toda la fila)</span>
            </label>
            {color && (
              <button
                type="button"
                onClick={() => setColor('')}
                className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 transition-colors"
              >
                Quitar color
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setColor('')}
              aria-label="Sin color de relleno"
              aria-pressed={!color}
              title="Sin color"
              className={`h-7 px-2 rounded-lg border-2 flex items-center gap-1 text-[11px] font-semibold transition-all ${
                !color
                  ? 'border-slate-900 bg-slate-100 text-slate-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Ban className="w-3 h-3" aria-hidden="true" />
              <span>Sin color</span>
            </button>
            {STUDENT_ROW_SWATCHES.map((sw) => {
              const isSelected = color.toLowerCase() === sw.hex.toLowerCase();
              return (
                <button
                  key={sw.hex}
                  type="button"
                  onClick={() => setColor(isSelected ? '' : sw.hex)}
                  title={sw.name}
                  aria-label={`Color ${sw.name}`}
                  aria-pressed={isSelected}
                  style={{ backgroundColor: sw.hex }}
                  className={`color-swatch-essential w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${
                    isSelected
                      ? 'border-slate-900 scale-110 shadow-xs'
                      : 'border-black/10 hover:scale-105'
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-slate-900 stroke-[2.75]" aria-hidden="true" />}
                </button>
              );
            })}
            <label
              title="Elegir color personalizado"
              className="relative flex items-center gap-1 px-1.5 h-7 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer text-[11px] font-medium text-slate-600"
            >
              <input
                type="color"
                aria-label="Color personalizado de fila"
                value={color || '#FEF08A'}
                onChange={(e) => setColor(e.target.value)}
                className="w-5 h-5 rounded border-0 bg-transparent cursor-pointer p-0"
              />
              <span>Otro</span>
            </label>
          </div>
          {color && (
            <div
              style={{
                backgroundColor: color,
                ['--student-row-bg' as string]: color,
              }}
              className="student-row-colored mt-2 px-3 py-1.5 rounded-xl border border-black/10 flex items-center justify-between text-[11.5px] font-semibold"
            >
              <span className="truncate">
                {lastName.trim() || firstName.trim()
                  ? `${lastName.trim()}${lastName.trim() && firstName.trim() ? ', ' : ''}${firstName.trim()}`
                  : 'Vista previa de la fila del alumno'}
              </span>
              <span className="opacity-75 tabular-nums text-[11px] ml-2">8,50 · 9,00 · 7,75</span>
            </div>
          )}
        </div>

        {/* Curated Student Attention Tags + Personal Notes together */}
        <div className="p-3 rounded-2xl border border-amber-200/80 bg-amber-50/35 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                <span>Etiquetas de seguimiento / atención</span>
              </label>
              {tags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTags([])}
                  className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 transition-colors"
                >
                  Limpiar etiquetas
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {STUDENT_TAG_CATALOG.map((tag) => {
                const isSelected = hasCatalogTag(tags, tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={isSelected}
                    title={tag.description}
                    onClick={() => handleToggleTag(tag.id)}
                    style={
                      isSelected
                        ? {
                            backgroundColor: tag.bgColor,
                            borderColor: tag.color,
                            color: tag.color,
                          }
                        : undefined
                    }
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'font-bold shadow-2xs ring-1 ring-black/5'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-medium'
                    }`}
                  >
                    <span
                      style={{
                        backgroundColor: tag.bgColor,
                        color: tag.color,
                        borderColor: tag.borderColor,
                      }}
                      className="w-6 h-6 rounded-lg border flex items-center justify-center shrink-0"
                    >
                      <StudentTagIcon name={tag.iconName} className="w-3.5 h-3.5" />
                    </span>
                    <span className="truncate flex-1 text-[11.5px] leading-tight">
                      {tag.label}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {customTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {customTags.map((ct) => (
                  <span
                    key={ct.rawKey}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-300"
                  >
                    <StudentTagIcon name="Tag" className="w-3 h-3 text-slate-500" />
                    <span>{ct.label}</span>
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((x) => x !== ct.rawKey))}
                      aria-label={`Quitar etiqueta ${ct.label}`}
                      className="hover:text-rose-600 ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="student-personal-notes"
              className="font-semibold text-slate-800 mb-1 flex items-center gap-1.5"
            >
              <StickyNote className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
              <span>Notas personales del profesor</span>
            </label>
            <textarea
              id="student-personal-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anotaciones privadas sobre adaptaciones, situación personal, conducta o seguimiento..."
              className="note-autosize-textarea w-full border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-200/70 focus:outline-none rounded-xl px-3 py-2 bg-white text-slate-800"
            />
          </div>
        </div>

        {editingStudent && activeBook && (
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2 max-h-48 overflow-y-auto">
            <div className="font-bold text-slate-800">Resumen de calificaciones en {activeBook.name}</div>
            {activeBook.tabs.map((tab) => (
              <div key={tab.id} className="space-y-1">
                <div className="text-[11px] font-bold text-slate-500">{tab.title}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {tab.columns.map((col) => {
                    const cell = activeBook.cells[cellKey(editingStudent.id, col.id)];
                    return (
                      <div
                        key={col.id}
                        className="flex items-center justify-between bg-white px-2 py-1 rounded-lg border border-slate-200"
                      >
                        <span className="truncate text-slate-700">{col.title}</span>
                        <span className="font-bold text-slate-900 tabular-nums ml-2">
                          {cell?.grade !== null && cell?.grade !== undefined
                            ? formatGrade(cell.grade, col.decimals)
                            : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          {editingStudent ? (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `¿Eliminar a "${editingStudent.firstName} ${editingStudent.lastName}" de la clase?`
                  )
                ) {
                  deleteStudent(editingStudent.id);
                  onClose();
                }
              }}
              className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Eliminar alumno</span>
            </button>
          ) : onOpenBulkStudents ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenBulkStudents();
              }}
              className="px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold flex items-center gap-1.5 text-xs"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Importar en masa</span>
            </button>
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
              {editingStudent ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              <span>{editingStudent ? 'Guardar' : 'Añadir alumno'}</span>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
