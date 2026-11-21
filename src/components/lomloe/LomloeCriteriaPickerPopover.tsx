import React, { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Eraser, ClipboardCopy, ClipboardPaste, Settings2, X } from 'lucide-react';
import type {
  ColumnEntity,
  LomloeCurriculum,
  LomloeKeyCompetenceDef,
} from '../../types/gradebook';
import { compareLomloeCodes } from '../../engine/lomloe';
import { LomloeCompetenceBadge } from './LomloeCompetenceBadge';

interface LomloeCriteriaPickerPopoverProps {
  column: ColumnEntity;
  curriculum: LomloeCurriculum | null;
  keyCompetences: LomloeKeyCompetenceDef[];
  anchorRect: { top: number; left: number; width: number; bottom: number };
  clipboardCriteriaIds: string[];
  onChangeCriteria: (criteriaIds: string[]) => void;
  onCopyCriteria: (criteriaIds: string[]) => void;
  onOpenLomloeManager: () => void;
  onClose: () => void;
}

export const LomloeCriteriaPickerPopover: React.FC<LomloeCriteriaPickerPopoverProps> = ({
  column,
  curriculum,
  keyCompetences,
  anchorRect,
  clipboardCriteriaIds,
  onChangeCriteria,
  onCopyCriteria,
  onOpenLomloeManager,
  onClose,
}) => {
  const [view, setView] = useState<'MENU' | 'CRITERIA'>('MENU');
  const [search, setSearch] = useState('');
  const [copiedNotice, setCopiedNotice] = useState(false);

  const selectedIds = useMemo(
    () => column.lomloeCriteriaIds ?? [],
    [column.lomloeCriteriaIds]
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const kcById = useMemo(
    () => new Map(keyCompetences.map((kc) => [kc.id, kc])),
    [keyCompetences]
  );

  const popWidth =
    typeof window !== 'undefined' ? Math.min(430, Math.max(280, window.innerWidth - 20)) : 430;
  const popMaxHeight =
    typeof window !== 'undefined' ? Math.min(460, Math.max(260, window.innerHeight - 36)) : 460;
  const left =
    typeof window !== 'undefined'
      ? Math.max(
          10,
          Math.min(window.innerWidth - popWidth - 10, anchorRect.left)
        )
      : anchorRect.left;
  const top =
    typeof window !== 'undefined'
      ? Math.max(
          12,
          Math.min(window.innerHeight - popMaxHeight - 16, anchorRect.bottom + 6)
        )
      : anchorRect.bottom + 6;

  const toggleCriterion = (criterionId: string) => {
    const next = selectedSet.has(criterionId)
      ? selectedIds.filter((id) => id !== criterionId)
      : [...selectedIds, criterionId];
    onChangeCriteria(next);
  };

  const selectedCriteria = useMemo(() => {
    if (!curriculum) return [];
    return curriculum.criteria
      .filter((cr) => selectedSet.has(cr.id) || selectedSet.has(cr.code))
      .sort((a, b) => compareLomloeCodes(a.code, b.code));
  }, [curriculum, selectedSet]);

  const filteredGroups = useMemo(() => {
    if (!curriculum) return [];
    const q = search.trim().toLowerCase();
    return curriculum.specificCompetences.map((ce) => {
      const items = curriculum.criteria
        .filter((cr) => cr.specificCompetenceId === ce.id)
        .filter((cr) => {
          if (!q) return true;
          return (
            cr.code.toLowerCase().includes(q) ||
            cr.description.toLowerCase().includes(q) ||
            ce.title.toLowerCase().includes(q)
          );
        })
        .sort((a, b) => compareLomloeCodes(a.code, b.code));
      return { ce, items };
    });
  }, [curriculum, search]);

  return (
    <div
      role="dialog"
      aria-label={`Criterios LOMLOE de ${column.title}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{ top, left, width: popWidth, maxHeight: popMaxHeight }}
      className="fixed z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-xs text-slate-800"
    >
      {/* iDoceo-style top action bar: < | Borrar todo | Copiar | Pegar | Hecho */}
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            if (view === 'CRITERIA') {
              setView('MENU');
            } else {
              onClose();
            }
          }}
          title={view === 'CRITERIA' ? 'Volver' : 'Cerrar'}
          aria-label={view === 'CRITERIA' ? 'Volver al resumen' : 'Cerrar selector LOMLOE'}
          className="p-1 rounded-lg text-blue-600 hover:bg-blue-50 flex items-center gap-0.5 font-semibold"
        >
          <ChevronLeft className="w-4 h-4" />
          {view === 'CRITERIA' && <span>Atrás</span>}
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => onChangeCriteria([])}
            className="text-blue-600 hover:text-blue-800 disabled:text-slate-300 font-semibold flex items-center gap-1 transition-colors"
            title="Quitar todos los criterios de esta columna"
          >
            <Eraser className="w-3.5 h-3.5" />
            <span>Borrar todo</span>
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => {
              onCopyCriteria(selectedIds);
              setCopiedNotice(true);
              setTimeout(() => setCopiedNotice(false), 1200);
            }}
            className="text-blue-600 hover:text-blue-800 disabled:text-slate-300 font-semibold flex items-center gap-1 transition-colors"
            title="Copiar criterios de esta columna"
          >
            <ClipboardCopy className="w-3.5 h-3.5" />
            <span>{copiedNotice ? 'Copiado' : 'Copiar'}</span>
          </button>
          <button
            type="button"
            disabled={clipboardCriteriaIds.length === 0}
            onClick={() => onChangeCriteria([...clipboardCriteriaIds])}
            className="text-blue-600 hover:text-blue-800 disabled:text-slate-300 font-semibold flex items-center gap-1 transition-colors"
            title="Pegar criterios copiados en esta columna"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>Pegar</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 rounded-lg text-blue-700 hover:bg-blue-50 font-bold"
        >
          Hecho
        </button>
      </div>

      {/* Column indicator strip */}
      <div className="px-3.5 py-1.5 bg-white border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
        <span className="font-bold text-slate-900 truncate">
          {column.title}
        </span>
        <span className="text-[11px] font-medium text-slate-500 shrink-0">
          {selectedCriteria.length === 0
            ? 'Sin criterios'
            : `${selectedCriteria.length} criterio${selectedCriteria.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* Body */}
      {!curriculum ? (
        <div className="p-5 text-center space-y-2.5 flex-1">
          <p className="text-slate-600 text-xs">
            Esta clase no tiene asignado ningún currículo LOMLOE todavía.
          </p>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenLomloeManager();
            }}
            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs inline-flex items-center gap-1.5"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Configurar currículo LOMLOE</span>
          </button>
        </div>
      ) : view === 'MENU' ? (
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {/* Primary drill-down row matching iDoceo screenshot ("Criterio >") */}
          <button
            type="button"
            onClick={() => setView('CRITERIA')}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-blue-50/60 transition-colors text-left"
          >
            <div>
              <div className="font-semibold text-slate-900 text-sm">Criterio</div>
              <div className="text-[11px] text-slate-500">
                Seleccionar criterios de evaluación LOMLOE ({curriculum.criteria.length} disponibles)
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-slate-400">
              {selectedCriteria.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold text-[11px]">
                  {selectedCriteria.length}
                </span>
              )}
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>

          {/* Summary list of currently attached criteria with quick remove */}
          {selectedCriteria.length > 0 && (
            <div className="p-3 space-y-2 bg-slate-50/40">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
                Criterios conectados a esta tarea
              </div>
              <div className="space-y-1.5">
                {selectedCriteria.map((cr) => {
                  const ce = curriculum.specificCompetences.find(
                    (item) => item.id === cr.specificCompetenceId
                  );
                  const kcIds =
                    cr.keyCompetenceIds && cr.keyCompetenceIds.length > 0
                      ? cr.keyCompetenceIds
                      : ce?.keyCompetenceIds ?? [];
                  return (
                    <div
                      key={cr.id}
                      className="p-2 rounded-xl bg-white border border-slate-200 flex items-start justify-between gap-2 shadow-2xs"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center flex-wrap gap-1.5">
                          <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-bold text-[11px]">
                            {cr.code}
                          </span>
                          {ce && (
                            <span className="text-[10px] font-bold text-slate-500">
                              CE {ce.number}
                            </span>
                          )}
                          <div className="flex items-center gap-0.5 flex-wrap">
                            {kcIds.map((kcId) => {
                              const kc = kcById.get(kcId);
                              return kc ? (
                                <LomloeCompetenceBadge
                                  key={kc.id}
                                  competence={kc}
                                  sizePx={15}
                                />
                              ) : null;
                            })}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-600 leading-snug line-clamp-2">
                          {cr.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCriterion(cr.id)}
                        title={`Quitar criterio ${cr.code}`}
                        className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/70 shrink-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar criterio (ej. 1.1, Biblia, cultura...)"
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
            {filteredGroups.map(({ ce, items }) => {
              if (items.length === 0) return null;
              return (
                <div key={ce.id} className="space-y-1">
                  <div className="px-2 py-1 rounded-lg bg-slate-100/90 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-bold text-slate-800 text-[11px]">
                        CE {ce.number}.
                      </span>{' '}
                      <span className="text-slate-600 text-[11px] font-medium">
                        {ce.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {ce.keyCompetenceIds.slice(0, 5).map((kcId) => {
                        const kc = kcById.get(kcId);
                        return kc ? (
                          <LomloeCompetenceBadge
                            key={kc.id}
                            competence={kc}
                            sizePx={13}
                          />
                        ) : null;
                      })}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {items.map((cr) => {
                      const checked = selectedSet.has(cr.id) || selectedSet.has(cr.code);
                      const kcIds =
                        cr.keyCompetenceIds && cr.keyCompetenceIds.length > 0
                          ? cr.keyCompetenceIds
                          : ce.keyCompetenceIds;
                      return (
                        <button
                          key={cr.id}
                          type="button"
                          onClick={() => toggleCriterion(cr.id)}
                          className={`w-full p-2 rounded-xl border text-left transition-colors flex items-start gap-2 ${
                            checked
                              ? 'bg-blue-50/90 border-blue-300'
                              : 'bg-white border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <span
                            className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                              checked
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-white border-slate-300'
                            }`}
                          >
                            {checked && <Check className="w-3 h-3" strokeWidth={3} />}
                          </span>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900">
                                {cr.code}
                              </span>
                              <div className="flex items-center gap-0.5 flex-wrap">
                                {kcIds.map((kcId) => {
                                  const kc = kcById.get(kcId);
                                  return kc ? (
                                    <LomloeCompetenceBadge
                                      key={kc.id}
                                      competence={kc}
                                      sizePx={14}
                                    />
                                  ) : null;
                                })}
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-snug">
                              {cr.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* iDoceo-style bottom footer bar: "Criterios seleccionados: Religión ... >" */}
      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenLomloeManager();
        }}
        className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200/80 border-t border-slate-200 flex items-center justify-between gap-2 text-left transition-colors shrink-0"
      >
        <span className="text-[11px] font-medium text-slate-700 truncate">
          Criterios seleccionados:{' '}
          <strong className="text-slate-900">
            {curriculum ? curriculum.name : 'Sin currículo'}
          </strong>
        </span>
        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
      </button>
    </div>
  );
};
