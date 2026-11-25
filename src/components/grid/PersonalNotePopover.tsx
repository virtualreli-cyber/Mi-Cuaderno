import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Eye, StickyNote, Trash2, X } from 'lucide-react';
import {
  STUDENT_TAG_CATALOG,
  hasCatalogTag,
  resolveStudentTags,
  toggleCatalogTag,
  type StudentTagId,
} from '../../constants/studentTags';
import type { StudentEntity } from '../../types/gradebook';
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
    };

export interface PersonalNoteEditorState {
  target: PersonalNoteTarget;
  rect: {
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

export const PersonalNotePopover: React.FC<PersonalNotePopoverProps> = ({
  editor,
  showNotesColumn,
  onSaveClassNote,
  onSaveStudent,
  onExpandNotesColumn,
  onClose,
}) => {
  const textareaId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
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
      setDraft(editor.target.student.notes ?? '');
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

  useEffect(() => {
    if (!editor) return;
    const onPointerDown = (e: PointerEvent) => {
      const node = containerRef.current;
      if (!node) return;
      if (node.contains(e.target as Node)) return;
      commitNoteText(draft);
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  });

  if (!editor) return null;

  const isStudent = editor.target.kind === 'STUDENT';
  const popWidth = Math.min(440, Math.max(330, Math.round(editor.rect.width + 12)));
  const estHeight = isStudent ? 320 : 210;
  const preferredLeft = editor.fromCollapsedIndicator
    ? editor.rect.right + 6
    : editor.rect.left - 4;
  const clampedLeft = Math.max(12, Math.min(window.innerWidth - popWidth - 12, preferredLeft));
  const fitsBelow = editor.rect.top + estHeight <= window.innerHeight - 12;
  const clampedTop = fitsBelow
    ? Math.max(12, editor.rect.top - 4)
    : Math.max(12, window.innerHeight - estHeight - 12);

  const handleToggleTag = (tagId: StudentTagId) => {
    if (editor.target.kind !== 'STUDENT') return;
    const next = toggleCatalogTag(tags, tagId);
    setTags(next);
    onSaveStudent(editor.target.student.id, { tags: next });
  };

  const customTags = isStudent ? resolveStudentTags(tags).filter((t) => t.isCustom) : [];

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="false"
      aria-label={
        editor.target.kind === 'STUDENT'
          ? `Notas personales y etiquetas de ${editor.target.displayName}`
          : `Notas privadas de la clase ${editor.target.bookName}`
      }
      data-personal-note-popover="true"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: clampedTop,
        left: clampedLeft,
        width: popWidth,
        zIndex: 92,
      }}
      className="rounded-2xl border-2 border-amber-300 bg-white shadow-2xl overflow-hidden text-xs"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-amber-50/90 border-b border-amber-200/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <StickyNote className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
          <span className="font-bold text-slate-900 truncate">
            {editor.target.kind === 'STUDENT'
              ? editor.target.displayName
              : `Notas de clase · ${editor.target.bookName}`}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!showNotesColumn && (
            <button
              type="button"
              onClick={() => {
                commitNoteText(draft);
                onExpandNotesColumn();
                onClose();
              }}
              title="Desplegar la columna completa de notas a la derecha de los alumnos"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-[10.5px] font-semibold text-amber-900 transition-colors"
            >
              <Eye className="w-3 h-3" aria-hidden="true" />
              <span>Abrir columna</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCloseAndSave}
            aria-label="Guardar y cerrar nota"
            title="Guardar y cerrar (Esc)"
            className="p-1 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-amber-100/80 transition-colors"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2.5">
        {/* Student characteristic tags picker */}
        {isStudent && (
          <div className="space-y-1.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              Etiquetas de atención
            </div>
            <div className="flex flex-wrap gap-1">
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
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] transition-all ${
                      isActive
                        ? 'font-bold shadow-2xs'
                        : 'bg-slate-50/70 border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 font-medium'
                    }`}
                  >
                    <StudentTagIcon name={tag.iconName} className="w-3 h-3 shrink-0" />
                    <span>{tag.shortLabel}</span>
                    {isActive && <Check className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {customTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {customTags.map((ct) => (
                  <span
                    key={ct.rawKey}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-slate-100 text-slate-700 border border-slate-300"
                  >
                    <StudentTagIcon name="Tag" className="w-2.5 h-2.5" />
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
                      className="hover:text-rose-600"
                    >
                      <X className="w-2.5 h-2.5" />
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
            className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1"
          >
            {isStudent ? 'Nota privada del alumno' : 'Nota privada de la clase'}
          </label>
          <textarea
            id={textareaId}
            ref={textareaRef}
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCloseAndSave();
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                handleCloseAndSave();
              }
            }}
            placeholder={
              isStudent
                ? 'Escribe observaciones privadas sobre adaptaciones, situación personal, conducta, avisos...'
                : 'Escribe notas privadas sobre esta clase (ritmo, acuerdos, avisos, incidencias generales)...'
            }
            className="note-autosize-textarea rounded-xl border border-amber-200 bg-amber-50/30 focus:bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-200/70 focus:outline-none px-2.5 py-2 text-[12.5px] leading-relaxed text-slate-900 placeholder:text-slate-400"
          />
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
          {draft.trim().length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setDraft('');
                commitNoteText('');
                onClose();
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              <span>Borrar nota</span>
            </button>
          ) : (
            <span className="text-[10.5px] text-slate-400">
              Ctrl/⌘+Enter o clic fuera para guardar
            </span>
          )}
          <button
            type="button"
            onClick={handleCloseAndSave}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11.5px] shadow-2xs transition-colors"
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Guardar</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
