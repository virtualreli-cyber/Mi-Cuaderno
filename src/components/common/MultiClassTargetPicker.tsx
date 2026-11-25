import React, { useMemo } from 'react';
import { Building2, Check, Folder, Layers } from 'lucide-react';
import type { ClassBook } from '../../types/gradebook';

export interface TargetClassSelection {
  tabId: string;
  folderId: string;
}

interface MultiClassTargetPickerProps {
  books: ClassBook[];
  currentBookId?: string | null;
  activeTabId?: string | null;
  preferredTabTitle?: string | null;
  selectedTargets: Record<string, TargetClassSelection>;
  onChangeTargets: (next: Record<string, TargetClassSelection>) => void;
  ariaLabel?: string;
}

export function resolveDefaultTabIdForBook(
  book: ClassBook,
  currentBookId?: string | null,
  activeTabId?: string | null,
  preferredTabTitle?: string | null
): string {
  if (book.id === currentBookId && activeTabId && book.tabs.some((t) => t.id === activeTabId)) {
    return activeTabId;
  }
  if (preferredTabTitle) {
    const norm = preferredTabTitle.trim().toLowerCase();
    const matched = book.tabs.find((t) => t.title.trim().toLowerCase() === norm);
    if (matched) return matched.id;
  }
  return book.tabs[0]?.id ?? '';
}

export const MultiClassTargetPicker: React.FC<MultiClassTargetPickerProps> = ({
  books,
  currentBookId = null,
  activeTabId = null,
  preferredTabTitle = null,
  selectedTargets,
  onChangeTargets,
  ariaLabel = 'Clases destino',
}) => {
  const selectedIds = useMemo(
    () => books.filter((b) => Boolean(selectedTargets[b.id])).map((b) => b.id),
    [books, selectedTargets]
  );

  const schoolNames = useMemo(() => {
    const set = new Set<string>();
    for (const b of books) {
      const s = b.school?.trim();
      if (s && !b.isTemplate) set.add(s);
    }
    return Array.from(set);
  }, [books]);

  const toggleBook = (book: ClassBook) => {
    const next = { ...selectedTargets };
    if (next[book.id]) {
      delete next[book.id];
    } else {
      next[book.id] = {
        tabId: resolveDefaultTabIdForBook(book, currentBookId, activeTabId, preferredTabTitle),
        folderId: '',
      };
    }
    onChangeTargets(next);
  };

  const selectGroup = (subset: ClassBook[]) => {
    const allSelected = subset.length > 0 && subset.every((b) => Boolean(selectedTargets[b.id]));
    const next = { ...selectedTargets };
    if (allSelected) {
      for (const b of subset) delete next[b.id];
    } else {
      for (const b of subset) {
        if (!next[b.id]) {
          next[b.id] = {
            tabId: resolveDefaultTabIdForBook(b, currentBookId, activeTabId, preferredTabTitle),
            folderId: '',
          };
        }
      }
    }
    onChangeTargets(next);
  };

  const updateBookTarget = (bookId: string, patch: Partial<TargetClassSelection>) => {
    const prev = selectedTargets[bookId];
    if (!prev) return;
    onChangeTargets({
      ...selectedTargets,
      [bookId]: { ...prev, ...patch },
    });
  };

  const nonTemplateBooks = books.filter((b) => !b.isTemplate);
  const allNonTemplateSelected =
    nonTemplateBooks.length > 0 && nonTemplateBooks.every((b) => Boolean(selectedTargets[b.id]));

  return (
    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5" aria-label={ariaLabel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-bold text-slate-800">
            Clases destino (elige una o varias)
          </div>
          <div className="text-[11px] text-slate-500">
            Puedes elegir una pestaña y carpeta distinta para cada clase
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${
              selectedIds.length > 0
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-200/80 text-slate-600'
            }`}
          >
            {selectedIds.length} {selectedIds.length === 1 ? 'clase' : 'clases'}
          </span>
          {nonTemplateBooks.length > 1 && (
            <button
              type="button"
              onClick={() => selectGroup(nonTemplateBooks)}
              className="px-2 py-0.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 transition-colors"
            >
              {allNonTemplateSelected ? 'Quitar todas' : 'Todas'}
            </button>
          )}
          {schoolNames.map((school) => {
            const schoolBooks = books.filter((b) => !b.isTemplate && b.school?.trim() === school);
            const allSchoolSel =
              schoolBooks.length > 0 && schoolBooks.every((b) => Boolean(selectedTargets[b.id]));
            return (
              <button
                key={school}
                type="button"
                onClick={() => selectGroup(schoolBooks)}
                className={`px-2 py-0.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ${
                  allSchoolSel
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700'
                }`}
              >
                <Building2 className="w-3 h-3 opacity-70" aria-hidden="true" />
                <span>{school}</span>
              </button>
            );
          })}
        </div>
      </div>

      {books.length === 0 ? (
        <p className="text-slate-500 italic">No hay clases disponibles.</p>
      ) : (
        <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-0.5">
          {books.map((book) => {
            const sel = selectedTargets[book.id];
            const isChecked = Boolean(sel);
            const sortedTabs = [...book.tabs].sort((a, b) => a.orderIndex - b.orderIndex);
            const chosenTab = sortedTabs.find((t) => t.id === sel?.tabId) ?? sortedTabs[0];
            const isCurrent = book.id === currentBookId;

            return (
              <div
                key={book.id}
                className={`rounded-xl border transition-colors ${
                  isChecked
                    ? 'border-blue-300 bg-white shadow-2xs'
                    : 'border-slate-200/90 bg-white/70 hover:bg-white'
                }`}
              >
                <label className="flex items-center justify-between gap-2 px-2.5 py-2 cursor-pointer">
                  <span className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleBook(book)}
                      className="accent-blue-600 w-3.5 h-3.5 rounded shrink-0 cursor-pointer"
                    />
                    <span
                      aria-hidden="true"
                      className="color-swatch-essential w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                      style={{ backgroundColor: book.color }}
                    />
                    <span className="font-bold text-slate-900 truncate">{book.name}</span>
                    {book.subject && (
                      <span className="text-[11px] text-slate-500 truncate hidden sm:inline">
                        — {book.subject}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="px-1.5 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-[10px] font-bold text-blue-800 shrink-0">
                        {book.isTemplate ? 'Plantilla actual' : 'Clase actual'}
                      </span>
                    )}
                  </span>

                  {isChecked && chosenTab && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-800 shrink-0">
                      <Check className="w-2.5 h-2.5 stroke-[3]" aria-hidden="true" />
                      <span className="max-w-[110px] truncate">{chosenTab.title}</span>
                    </span>
                  )}
                </label>

                {isChecked && sel && (
                  <div className="px-2.5 pb-2.5 pt-1 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50/50 rounded-b-xl">
                    <label className="block space-y-1">
                      <span className="flex items-center gap-1 text-[10.5px] font-semibold text-slate-600">
                        <Layers className="w-3 h-3 text-slate-400" aria-hidden="true" />
                        <span>Pestaña en {book.name}</span>
                      </span>
                      <select
                        value={sel.tabId}
                        onChange={(e) =>
                          updateBookTarget(book.id, { tabId: e.target.value, folderId: '' })
                        }
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-xs text-slate-800"
                      >
                        {sortedTabs.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                            {isCurrent && t.id === activeTabId ? ' (actual)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="flex items-center gap-1 text-[10.5px] font-semibold text-slate-600">
                        <Folder className="w-3 h-3 text-slate-400" aria-hidden="true" />
                        <span>Carpeta (opcional)</span>
                      </span>
                      <select
                        value={sel.folderId}
                        onChange={(e) =>
                          updateBookTarget(book.id, { folderId: e.target.value })
                        }
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-xs text-slate-800"
                      >
                        <option value="">Sin carpeta (suelta)</option>
                        {(chosenTab?.folders ?? []).map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
