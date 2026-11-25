import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Eye, StickyNote, Tag, Trash2, X } from 'lucide-react';
import {
  STUDENT_TAG_CATALOG,
  hasCatalogTag,
  resolveStudentTags,
  toggleCatalogTag,
  type StudentTagId,
} from '../../constants/studentTags';
import type { StudentEntity } from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { StudentTagIcon } from '../common/StudentTagIcon';

export type PersonalNoteTarget =
  | {
      kind: 'CLASS';
      bookId: string;
      bookName: string;
      initialNotes: string;
    }
  | {
      kind: 'STUDENT';
      student: StudentEntity;
      displayName: string;
      initialNotes?: string;
    };

export interface PersonalNoteEditorState {
  target: PersonalNoteTarget;
  rect?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
  };
  /** True when opened from the collapsed micro-indicator rather than inside the notes column */
  fromCollapsedIndicator?: boolean;
}

interface PersonalNotePopoverProps {
  editor: PersonalNoteEditorState | null;
  showNotesColumn: boolean;
  onSaveClassNote: (bookId: string, nextNote: string) => void;
  onSaveStudent: (studentId: string, patch: { notes?: string; tags?: string[] }) => void;
  onExpandNotesColumn: () => void;
  onClose: () => void;
}

/**
 * Full modal for editing private notes (class or student) and toggling student characteristic tags
 * (icons + full labels + descriptions, 1-click select/deselect).
 * Triggered by double-clicking any cell in the Personal Notes Column or clicking a collapsed micro-indicator.
 */
export const PersonalNotePopover: React.FC<PersonalNotePopoverProps> = ({
  editor,
  showNotesColumn,
  onSaveClassNote,
  onSaveStudent,
  onExpandNotesColumn,
  onClose,
}) => {
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [draft, setDraft] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const savedRef = useRef(false);

  useEffect(() => {
    if (!editor) return;
    savedRef.current = false;
    if (editor.target.kind === 'CLASS') {
      setDraft(editor.target.initialNotes);
      setTags([]);
    } else {
      setDraft(editor.target.initialNotes ?? editor.target.student.notes ?? '');
      setTags(editor.target.student.tags ?? []);
    }
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
      }
    });
  }, [editor]);

  const commitNoteText = (textToSave: string) => {
    if (!editor || savedRef.current) return;
    savedRef.current = true;
    const trimmed = textToSave.trim();
    if (editor.target.kind === 'CLASS') {
      if (trimmed !== editor.target.initialNotes.trim()) {
        onSaveClassNote(editor.target.bookId, trimmed);
      }
    } else {
      const prevTrimmed = (editor.target.student.notes ?? '').trim();
      if (trimmed !== prevTrimmed) {
        onSaveStudent(editor.target.student.id, { notes: trimmed || undefined });
      }
    }
  };

  const handleCloseAndSave = () => {
    commitNoteText(draft);
    onClose();
  };

  if (!editor) return null;

  const isStudent = editor.target.kind === 'STUDENT';

  const handleToggleTag = (tagId: StudentTagId) => {
    if (editor.target.kind !== 'STUDENT') return;
    const next = toggleCatalogTag(tags, tagId);
    setTags(next);
    onSaveStudent(editor.target.student.id, { tags: next });
  };

  const customTags = isStudent ? resolveStudentTags(tags).filter((t) => t.isCustom) : [];

  return (
    <Modal
      open={Boolean(editor)}
      onClose={handleCloseAndSave}
      title={
        editor.target.kind === 'STUDENT'
          ? editor.target.displayName
          : `Notas privadas · ${editor.target.bookName}`
      }
      subtitle={
        isStudent
          ? 'Etiquetas de atención y notas privadas del alumno'
          : 'Anotaciones privadas sobre toda la clase'
      }
      maxWidthClass="w-[min(560px,95vw)]"
      headerActions={
        !showNotesColumn ? (
          <button
            type="button"
            onClick={() => {
              commitNoteText(draft);
              onExpandNotesColumn();
              onClose();
            }}
            title="Desplegar la columna de notas privadas junto a los alumnos"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-[11px] font-semibold text-amber-900 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Abrir columna</span>
          </button>
        ) : undefined
      }
    >
      <div className="p-5 space-y-4 text-xs" data-personal-note-popover="true">
        {/* Student characteristic tags picker (Icons + full labels in this modal!) */}
        {isStudent && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                <span>Etiquetas de seguimiento / atención</span>
              </div>
              {tags.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (editor.target.kind !== 'STUDENT') return;
                    setTags([]);
                    onSaveStudent(editor.target.student.id, { tags: [] });
                  }}
                  className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 transition-colors"
                >
                  Quitar todas
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {STUDENT_TAG_CATALOG.map((tag) => {
                const isActive = hasCatalogTag(tags, tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={isActive}
                    title={tag.description}
                    onClick={() => handleToggleTag(tag.id)}
                    style={
                      isActive
                        ? {
                            backgroundColor: tag.bgColor,
                            borderColor: tag.color,
                            color: tag.color,
                          }
                        : undefined
                    }
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left transition-all ${
                      isActive
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
                      className="w-7 h-7 rounded-lg border flex items-center justify-center shrink-0"
                    >
                      <StudentTagIcon name={tag.iconName} className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] leading-tight">{tag.label}</span>
                      <span className="block truncate text-[10px] opacity-75 font-normal">
                        {tag.description}
                      </span>
                    </span>
                    {isActive && <Check className="w-4 h-4 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>

            {customTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {customTags.map((ct) => (
                  <span
                    key={ct.rawKey}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-300"
                  >
                    <StudentTagIcon name="Tag" className="w-3 h-3" />
                    <span>{ct.label}</span>
                    <button
                      type="button"
                      aria-label={`Quitar etiqueta ${ct.label}`}
                      onClick={() => {
                        if (editor.target.kind !== 'STUDENT') return;
                        const next = tags.filter((t) => t !== ct.rawKey);
                        setTags(next);
                        onSaveStudent(editor.target.student.id, { tags: next });
                      }}
                      className="hover:text-rose-600 ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Editable personal note textarea */}
        <div>
          <label
            htmlFor={textareaId}
            className="font-semibold text-slate-800 mb-1.5 flex items-center gap-1.5"
          >
            <StickyNote className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
            <span>{isStudent ? 'Notas privadas del alumno' : 'Notas privadas de la clase'}</span>
          </label>
          <textarea
            id={textareaId}
            ref={textareaRef}
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                handleCloseAndSave();
              }
            }}
            placeholder={
              isStudent
                ? 'Escribe observaciones privadas sobre adaptaciones, situación personal, conducta, avisos...'
                : 'Escribe notas privadas sobre esta clase (tutor/a, ritmo, acuerdos, incidencias generales)...'
            }
            className="note-autosize-textarea rounded-xl border border-amber-200 bg-amber-50/25 focus:bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-200/70 focus:outline-none px-3 py-2.5 text-[13px] leading-relaxed text-slate-900 placeholder:text-slate-400"
          />
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200">
          {draft.trim().length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setDraft('');
                commitNoteText('');
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Borrar nota</span>
            </button>
          ) : (
            <span className="text-[11px] text-slate-400">
              Ctrl/⌘+Enter para guardar rápidamente
            </span>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCloseAndSave}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-xs transition-colors"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Guardar</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
