import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_LOMLOE_KEY_COMPETENCES,
  DEFAULT_LOMLOE_RELIGION_CURRICULA,
} from '../../data/lomloeReligion';
import { formatGrade, makeId } from '../../engine/gradeMath';
import {
  compareLomloeCodes,
  computeStudentLomloeStats,
  inferReligionCurriculumId,
  isLomloeRowVisible,
  resolveBookCurriculum,
} from '../../engine/lomloe';
import { useGradebook } from '../../context/GradebookContext';
import type {
  LomloeCriterion,
  LomloeCurriculum,
  LomloeKeyCompetenceDef,
  LomloeSpecificCompetence,
} from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { NumericInput } from '../common/NumericInput';
import { LOMLOE_ICON_OPTIONS, LomloeCompetenceBadge } from './LomloeCompetenceBadge';

interface LomloeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ModalTab = 'CURRICULA' | 'KEY_COMPETENCES' | 'OVERVIEW';

const KC_COLOR_PRESETS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
];

export const LomloeModal: React.FC<LomloeModalProps> = ({ isOpen, onClose }) => {
  const {
    workspace,
    activeBook,
    activeTab,
    updateBook,
    updateSettings,
    saveLomloeCurriculum,
    deleteLomloeCurriculum,
    resetDefaultLomloeCurricula,
    updateLomloeKeyCompetences,
  } = useGradebook();

  const curricula = useMemo(
    () =>
      workspace.lomloeCurricula && workspace.lomloeCurricula.length > 0
        ? workspace.lomloeCurricula
        : DEFAULT_LOMLOE_RELIGION_CURRICULA,
    [workspace.lomloeCurricula]
  );

  const keyCompetences = useMemo(
    () =>
      workspace.lomloeKeyCompetences && workspace.lomloeKeyCompetences.length > 0
        ? [...workspace.lomloeKeyCompetences].sort((a, b) => a.number - b.number)
        : DEFAULT_LOMLOE_KEY_COMPETENCES,
    [workspace.lomloeKeyCompetences]
  );

  const resolvedBookCurriculum = useMemo(
    () => resolveBookCurriculum(activeBook, curricula),
    [activeBook, curricula]
  );

  const inferredBookCurrId = useMemo(
    () => inferReligionCurriculumId(activeBook?.name, activeBook?.subject),
    [activeBook?.name, activeBook?.subject]
  );

  const [tab, setTab] = useState<ModalTab>('CURRICULA');
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string>(
    resolvedBookCurriculum?.id ?? curricula[0]?.id ?? 'lomloe-rel-eso-1-2'
  );
  const [expandedCeIds, setExpandedCeIds] = useState<Record<string, boolean>>({});
  const [editingCriterion, setEditingCriterion] = useState<{
    ceId: string;
    criterion: LomloeCriterion | null;
  } | null>(null);
  const [overviewScope, setOverviewScope] = useState<'ACTIVE_TAB' | 'ALL_TABS'>('ACTIVE_TAB');

  useEffect(() => {
    if (!isOpen) return;
    const preferred = resolvedBookCurriculum?.id ?? curricula[0]?.id;
    if (preferred) {
      setSelectedCurriculumId(preferred);
    }
    setEditingCriterion(null);
  }, [isOpen, resolvedBookCurriculum?.id, curricula]);

  const selectedCurriculum = useMemo(
    () => curricula.find((c) => c.id === selectedCurriculumId) ?? curricula[0] ?? null,
    [curricula, selectedCurriculumId]
  );

  const showLomloeRow = isLomloeRowVisible(activeBook, workspace.settings);

  const kcById = useMemo(
    () => new Map(keyCompetences.map((kc) => [kc.id, kc])),
    [keyCompetences]
  );

  const overviewTabs = useMemo(() => {
    if (!activeBook) return [];
    if (overviewScope === 'ACTIVE_TAB' && activeTab) return [activeTab];
    return activeBook.tabs;
  }, [activeBook, activeTab, overviewScope]);

  const connectedCriteriaInOverview = useMemo(() => {
    if (!resolvedBookCurriculum) return [];
    const usedIds = new Set<string>();
    for (const t of overviewTabs) {
      for (const col of t.columns) {
        for (const id of col.lomloeCriteriaIds ?? []) {
          usedIds.add(id);
        }
      }
    }
    return resolvedBookCurriculum.criteria
      .filter((cr) => usedIds.has(cr.id) || usedIds.has(cr.code))
      .sort((a, b) => compareLomloeCodes(a.code, b.code));
  }, [resolvedBookCurriculum, overviewTabs]);

  if (!isOpen) return null;

  const updateSelectedCurriculum = (updater: (cur: LomloeCurriculum) => LomloeCurriculum) => {
    if (!selectedCurriculum) return;
    saveLomloeCurriculum(updater(selectedCurriculum));
  };

  const handleToggleCeKeyCompetence = (ceId: string, kcId: string) => {
    updateSelectedCurriculum((cur) => ({
      ...cur,
      specificCompetences: cur.specificCompetences.map((ce) => {
        if (ce.id !== ceId) return ce;
        const exists = ce.keyCompetenceIds.includes(kcId);
        return {
          ...ce,
          keyCompetenceIds: exists
            ? ce.keyCompetenceIds.filter((id) => id !== kcId)
            : [...ce.keyCompetenceIds, kcId],
        };
      }),
    }));
  };

  const handleUpdateCeField = (
    ceId: string,
    patch: Partial<LomloeSpecificCompetence>
  ) => {
    updateSelectedCurriculum((cur) => ({
      ...cur,
      specificCompetences: cur.specificCompetences.map((ce) =>
        ce.id === ceId ? { ...ce, ...patch } : ce
      ),
    }));
  };

  const handleAddSpecificCompetence = () => {
    if (!selectedCurriculum) return;
    const nextNum =
      selectedCurriculum.specificCompetences.reduce(
        (m, ce) => Math.max(m, ce.number),
        0
      ) + 1;
    const newCe: LomloeSpecificCompetence = {
      id: makeId('ce'),
      number: nextNum,
      code: `CE ${nextNum}`,
      title: `Nueva Competencia Específica ${nextNum}`,
      description: '',
      keyCompetenceIds: ['CCL'],
    };
    updateSelectedCurriculum((cur) => ({
      ...cur,
      specificCompetences: [...cur.specificCompetences, newCe],
    }));
    setExpandedCeIds((prev) => ({ ...prev, [newCe.id]: true }));
  };

  const handleDeleteSpecificCompetence = (ceId: string) => {
    if (!selectedCurriculum || selectedCurriculum.specificCompetences.length <= 1) return;
    updateSelectedCurriculum((cur) => ({
      ...cur,
      specificCompetences: cur.specificCompetences.filter((ce) => ce.id !== ceId),
      criteria: cur.criteria.filter((cr) => cr.specificCompetenceId !== ceId),
    }));
  };

  const handleSaveCriterion = (draft: LomloeCriterion, isNew: boolean) => {
    updateSelectedCurriculum((cur) => {
      const nextCriteria = isNew
        ? [...cur.criteria, draft]
        : cur.criteria.map((cr) => (cr.id === draft.id ? draft : cr));
      return {
        ...cur,
        criteria: nextCriteria.sort((a, b) => compareLomloeCodes(a.code, b.code)),
      };
    });
    setEditingCriterion(null);
  };

  const handleDeleteCriterion = (criterionId: string) => {
    updateSelectedCurriculum((cur) => ({
      ...cur,
      criteria: cur.criteria.filter((cr) => cr.id !== criterionId),
    }));
  };

  const handleCreateCustomCurriculum = () => {
    const base = selectedCurriculum ?? curricula[0];
    const id = makeId('cur');
    const created: LomloeCurriculum = {
      id,
      name: `Currículo personalizado ${curricula.length + 1}`,
      subject: 'Religión Católica',
      stage: 'CUSTOM',
      legalReference: 'Personalizado',
      specificCompetences: (base?.specificCompetences ?? []).map((ce) => ({
        ...ce,
        keyCompetenceIds: [...ce.keyCompetenceIds],
      })),
      criteria: (base?.criteria ?? []).map((cr) => ({
        ...cr,
        keyCompetenceIds: cr.keyCompetenceIds ? [...cr.keyCompetenceIds] : undefined,
      })),
    };
    saveLomloeCurriculum(created);
    setSelectedCurriculumId(id);
  };

  const handleUpdateKeyCompetence = (
    kcId: string,
    patch: Partial<LomloeKeyCompetenceDef>
  ) => {
    updateLomloeKeyCompetences(
      keyCompetences.map((kc) => (kc.id === kcId ? { ...kc, ...patch } : kc))
    );
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Currículo LOMLOE · Religión Católica (1º ESO – 1º BAC)"
      subtitle="Configura Competencias Clave, Competencias Específicas y Criterios de Evaluación (BOE-A-2022-10452)"
      maxWidthClass="w-[min(1024px,95vw)]"
    >
      <div className="flex flex-col">
        {/* Active Class Curriculum Binding Bar */}
        {activeBook && (
          <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-bold text-slate-700">Clase activa:</span>
              <span
                className="px-2.5 py-0.5 rounded-lg font-bold text-slate-800 border border-slate-300/70"
                style={{ backgroundColor: activeBook.color }}
              >
                {activeBook.name}
              </span>

              <select
                value={activeBook.lomloeCurriculumId ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  updateBook(activeBook.id, {
                    lomloeCurriculumId: val === '' ? null : val,
                  });
                }}
                aria-label="Currículo asignado a la clase activa"
                className="px-2.5 py-1 rounded-xl border border-slate-300 bg-white font-semibold text-slate-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="">
                  Automático por curso (
                  {inferredBookCurrId
                    ? curricula.find((c) => c.id === inferredBookCurrId)?.name ?? 'Detectado'
                    : 'Sin detectar'}
                  )
                </option>
                {curricula.map((cur) => (
                  <option key={cur.id} value={cur.id}>
                    {cur.name}
                  </option>
                ))}
                <option value="NONE">Desactivado para esta clase</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const next = !showLomloeRow;
                  updateBook(activeBook.id, { showLomloeRow: next });
                  updateSettings({ showLomloeRow: next });
                }}
                className={`px-3 py-1 rounded-xl border font-semibold flex items-center gap-1.5 transition-colors ${
                  showLomloeRow
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-white border-slate-300 text-slate-600'
                }`}
              >
                {showLomloeRow ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
                <span>
                  {showLomloeRow ? 'Visible en el cuaderno' : 'Oculto en el cuaderno'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Modal Section Tabs */}
        <div className="px-6 pt-2.5 border-b border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTab('CURRICULA')}
              className={`px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors ${
                tab === 'CURRICULA'
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpenCheck className="w-4 h-4" />
              <span>Competencias Específicas y Criterios</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('KEY_COMPETENCES')}
              className={`px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors ${
                tab === 'KEY_COMPETENCES'
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Award className="w-4 h-4" />
              <span>Competencias Clave (1–8)</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('OVERVIEW')}
              className={`px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors ${
                tab === 'OVERVIEW'
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Evaluación LOMLOE de la clase</span>
            </button>
          </div>

          <button
            type="button"
            onClick={resetDefaultLomloeCurricula}
            title="Restaurar los currículos oficiales de Religión Católica (BOE-A-2022-10452) y competencias clave por defecto"
            className="mb-1 px-2.5 py-1 rounded-lg border border-slate-200 hover:border-amber-300 hover:bg-amber-50 text-[11px] font-semibold text-slate-600 hover:text-amber-800 flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restablecer BOE oficial</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/60">
          {tab === 'CURRICULA' && (
            <div className="space-y-4">
              {/* Course / Cycle Pills */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {curricula.map((cur) => {
                    const active = selectedCurriculum?.id === cur.id;
                    const isAssignedToBook = resolvedBookCurriculum?.id === cur.id;
                    return (
                      <button
                        key={cur.id}
                        type="button"
                        onClick={() => setSelectedCurriculumId(cur.id)}
                        className={`px-3.5 py-2 rounded-2xl text-xs font-bold border transition-all flex items-center gap-2 ${
                          active
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
                        }`}
                      >
                        <span>{cur.name}</span>
                        {isAssignedToBook && (
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                              active
                                ? 'bg-white/20 text-white'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            En uso
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={handleCreateCustomCurriculum}
                    className="px-3 py-2 rounded-2xl text-xs font-semibold border border-dashed border-slate-300 bg-white hover:border-indigo-400 hover:text-indigo-700 text-slate-600 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nuevo currículo</span>
                  </button>
                </div>

                {selectedCurriculum && curricula.length > 1 && selectedCurriculum.stage === 'CUSTOM' && (
                  <button
                    type="button"
                    onClick={() => {
                      deleteLomloeCurriculum(selectedCurriculum.id);
                      setSelectedCurriculumId(curricula[0].id);
                    }}
                    className="px-2.5 py-1.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar currículo</span>
                  </button>
                )}
              </div>

              {selectedCurriculum && (
                <>
                  {/* Curriculum Metadata Editor */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
                    <div className="flex-1 min-w-[220px]">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Nombre del currículo
                      </label>
                      <input
                        type="text"
                        value={selectedCurriculum.name}
                        onChange={(e) =>
                          updateSelectedCurriculum((cur) => ({
                            ...cur,
                            name: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex-1 min-w-[220px]">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Referencia normativa
                      </label>
                      <input
                        type="text"
                        value={selectedCurriculum.legalReference ?? ''}
                        onChange={(e) =>
                          updateSelectedCurriculum((cur) => ({
                            ...cur,
                            legalReference: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-700 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddSpecificCompetence}
                      className="mt-4 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center gap-1.5 border border-indigo-200"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Añadir Comp. Específica</span>
                    </button>
                  </div>

                  {/* Specific Competences + Evaluation Criteria Accordions */}
                  <div className="space-y-3">
                    {selectedCurriculum.specificCompetences.map((ce) => {
                      const ceCriteria = selectedCurriculum.criteria
                        .filter((cr) => cr.specificCompetenceId === ce.id)
                        .sort((a, b) => compareLomloeCodes(a.code, b.code));
                      const isExpanded = expandedCeIds[ce.id] ?? true;

                      return (
                        <div
                          key={ce.id}
                          className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs"
                        >
                          {/* Specific Competence Header */}
                          <div className="p-3.5 bg-slate-50/70 border-b border-slate-200 flex items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCeIds((prev) => ({
                                  ...prev,
                                  [ce.id]: !isExpanded,
                                }))
                              }
                              className="mt-1 p-1 rounded-lg hover:bg-slate-200/70 text-slate-500 shrink-0"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>

                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white font-extrabold text-xs">
                                  CE {ce.number}
                                </span>
                                <input
                                  type="text"
                                  value={ce.title}
                                  onChange={(e) =>
                                    handleUpdateCeField(ce.id, { title: e.target.value })
                                  }
                                  className="flex-1 min-w-[240px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                                />
                              </div>

                              {/* Connected Key Competences (toggleable pills) */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] font-semibold text-slate-500 mr-1">
                                  Perfil de salida (Competencias clave):
                                </span>
                                {keyCompetences.map((kc) => {
                                  const active = ce.keyCompetenceIds.includes(kc.id);
                                  return (
                                    <button
                                      key={kc.id}
                                      type="button"
                                      onClick={() => handleToggleCeKeyCompetence(ce.id, kc.id)}
                                      title={`${kc.number}. ${kc.code} — ${kc.name}`}
                                      className={`inline-flex items-center gap-1 pr-2 pl-0.5 py-0.5 rounded-full border text-[11px] font-bold transition-all ${
                                        active
                                          ? 'bg-white border-slate-400 text-slate-900 shadow-2xs ring-1 ring-indigo-200'
                                          : 'bg-slate-100/70 border-slate-200 text-slate-400 opacity-60 hover:opacity-100'
                                      }`}
                                    >
                                      <LomloeCompetenceBadge
                                        competence={kc}
                                        sizePx={16}
                                      />
                                      <span>{kc.code}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {selectedCurriculum.specificCompetences.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSpecificCompetence(ce.id)}
                                title={`Eliminar ${ce.code}`}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          {/* Criteria List */}
                          {isExpanded && (
                            <div className="p-3 space-y-2">
                              {ceCriteria.map((cr) => {
                                const effectiveKcIds =
                                  cr.keyCompetenceIds && cr.keyCompetenceIds.length > 0
                                    ? cr.keyCompetenceIds
                                    : ce.keyCompetenceIds;
                                return (
                                  <div
                                    key={cr.id}
                                    className="p-2.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-200 flex items-start justify-between gap-3"
                                  >
                                    <div className="min-w-0 flex-1 space-y-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-extrabold text-xs">
                                          {cr.code}
                                        </span>
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {effectiveKcIds.map((kcId) => {
                                            const kc = kcById.get(kcId);
                                            return kc ? (
                                              <LomloeCompetenceBadge
                                                key={kc.id}
                                                competence={kc}
                                                sizePx={16}
                                              />
                                            ) : null;
                                          })}
                                        </div>
                                        {cr.keyCompetenceIds &&
                                          cr.keyCompetenceIds.length > 0 && (
                                            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                              Competencias personalizadas
                                            </span>
                                          )}
                                      </div>
                                      <p className="text-xs text-slate-700 leading-relaxed">
                                        {cr.description}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditingCriterion({
                                            ceId: ce.id,
                                            criterion: cr,
                                          })
                                        }
                                        className="px-2 py-1 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-[11px] font-semibold text-slate-700"
                                      >
                                        Editar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteCriterion(cr.id)}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                                        title={`Eliminar criterio ${cr.code}`}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}

                              <button
                                type="button"
                                onClick={() =>
                                  setEditingCriterion({
                                    ceId: ce.id,
                                    criterion: null,
                                  })
                                }
                                className="w-full py-1.5 rounded-xl border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 text-xs font-semibold text-slate-600 hover:text-indigo-700 flex items-center justify-center gap-1"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Añadir criterio a CE {ce.number}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'KEY_COMPETENCES' && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 text-xs text-slate-600">
                Personaliza el número, las siglas, el nombre, el color e icono circular de las{' '}
                <strong>8 Competencias Clave LOMLOE</strong> tal como aparecerán bajo cada columna del cuaderno.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {keyCompetences.map((kc) => (
                  <div
                    key={kc.id}
                    className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2.5 shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <LomloeCompetenceBadge competence={kc} sizePx={36} />
                      <div className="flex-1 min-w-0 grid grid-cols-4 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">
                            Nº
                          </label>
                          <NumericInput
                            integer
                            min={1}
                            max={99}
                            emptyValue={1}
                            value={kc.number}
                            aria-label={`Número de competencia ${kc.code}`}
                            onChange={(val) =>
                              handleUpdateKeyCompetence(kc.id, {
                                number: val,
                              })
                            }
                            className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-900 tabular-nums"
                          />
                        </div>
                        <div className="col-span-3">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">
                            Siglas
                          </label>
                          <input
                            type="text"
                            value={kc.code}
                            onChange={(e) =>
                              handleUpdateKeyCompetence(kc.id, {
                                code: e.target.value.trim() || kc.id,
                              })
                            }
                            className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-900"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                        Nombre oficial
                      </label>
                      <input
                        type="text"
                        value={kc.name}
                        onChange={(e) =>
                          handleUpdateKeyCompetence(kc.id, { name: e.target.value })
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        {KC_COLOR_PRESETS.map((hex) => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => handleUpdateKeyCompetence(kc.id, { color: hex })}
                            style={{ backgroundColor: hex }}
                            className={`w-5 h-5 rounded-full border-2 ${
                              kc.color.toLowerCase() === hex.toLowerCase()
                                ? 'border-slate-900 scale-110'
                                : 'border-white'
                            }`}
                            title={hex}
                          />
                        ))}
                        <input
                          type="color"
                          value={kc.color}
                          onChange={(e) =>
                            handleUpdateKeyCompetence(kc.id, { color: e.target.value })
                          }
                          title="Elegir otro color"
                          className="w-6 h-6 rounded-full cursor-pointer border-0 bg-transparent p-0"
                        />
                      </div>

                      <select
                        value={kc.iconName}
                        onChange={(e) =>
                          handleUpdateKeyCompetence(kc.id, { iconName: e.target.value })
                        }
                        aria-label={`Icono para ${kc.code}`}
                        className="px-2 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
                      >
                        {LOMLOE_ICON_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'OVERVIEW' && (
            <div className="space-y-3">
              {!activeBook || !resolvedBookCurriculum ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-500">
                  Selecciona o asigna un currículo LOMLOE a la clase para ver el desglose por criterios y competencias del alumnado.
                </div>
              ) : (
                <>
                  <div className="bg-white rounded-2xl border border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <span className="font-bold text-slate-900">
                        {resolvedBookCurriculum.name}
                      </span>{' '}
                      <span className="text-slate-500">
                        · {connectedCriteriaInOverview.length} criterios evaluados en{' '}
                        {overviewScope === 'ACTIVE_TAB'
                          ? activeTab?.title ?? 'la pestaña'
                          : 'todo el curso'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setOverviewScope('ACTIVE_TAB')}
                        className={`px-2.5 py-1 rounded-lg font-semibold ${
                          overviewScope === 'ACTIVE_TAB'
                            ? 'bg-white text-indigo-700 shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        Evaluación actual ({activeTab?.title})
                      </button>
                      <button
                        type="button"
                        onClick={() => setOverviewScope('ALL_TABS')}
                        className={`px-2.5 py-1 rounded-lg font-semibold ${
                          overviewScope === 'ALL_TABS'
                            ? 'bg-white text-indigo-700 shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        Todo el curso
                      </button>
                    </div>
                  </div>

                  {connectedCriteriaInOverview.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-500">
                      Todavía no hay columnas conectadas a ningún criterio en{' '}
                      {overviewScope === 'ACTIVE_TAB' ? 'esta pestaña' : 'esta clase'}. Haz clic en la fila LOMLOE debajo de cualquier cabecera en el cuaderno para conectar criterios.
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-2xs">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-bold text-slate-800 border-r border-slate-200 min-w-[200px]">
                              Alumno/a
                            </th>
                            {connectedCriteriaInOverview.map((cr) => (
                              <th
                                key={cr.id}
                                title={cr.description}
                                className="px-2.5 py-2 text-center font-bold text-blue-800 border-r border-slate-200 min-w-[64px]"
                              >
                                {cr.code}
                              </th>
                            ))}
                            {keyCompetences.map((kc) => (
                              <th
                                key={kc.id}
                                title={kc.name}
                                className="px-2 py-2 text-center border-r border-slate-200 min-w-[56px]"
                              >
                                <div className="flex flex-col items-center gap-0.5">
                                  <LomloeCompetenceBadge competence={kc} sizePx={16} />
                                  <span className="text-[10px] font-bold text-slate-600">
                                    {kc.code}
                                  </span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeBook.students
                            .filter((s) => !s.isHidden)
                            .map((student) => {
                              const stats = computeStudentLomloeStats(
                                student.id,
                                overviewTabs,
                                activeBook.cells,
                                resolvedBookCurriculum,
                                keyCompetences
                              );
                              return (
                                <tr key={student.id} className="hover:bg-slate-50/70">
                                  <td className="sticky left-0 bg-white px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-200 truncate max-w-[240px]">
                                    {student.lastName}, {student.firstName}
                                  </td>
                                  {connectedCriteriaInOverview.map((cr) => {
                                    const entry = stats.byCriterion[cr.id];
                                    const val = entry?.avg ?? null;
                                    return (
                                      <td
                                        key={cr.id}
                                        className={`px-2 py-1.5 text-center border-r border-slate-100 tabular-nums font-semibold ${
                                          val === null
                                            ? 'text-slate-300'
                                            : val < 5
                                              ? 'bg-red-50 text-red-700'
                                              : val < 6
                                                ? 'bg-orange-50 text-orange-700'
                                                : 'text-slate-800'
                                        }`}
                                      >
                                        {val === null ? '—' : formatGrade(val, 2)}
                                      </td>
                                    );
                                  })}
                                  {keyCompetences.map((kc) => {
                                    const entry = stats.byKeyCompetence[kc.id];
                                    const val = entry?.avg ?? null;
                                    return (
                                      <td
                                        key={kc.id}
                                        className={`px-2 py-1.5 text-center border-r border-slate-100 tabular-nums font-bold ${
                                          val === null
                                            ? 'text-slate-300'
                                            : val < 5
                                              ? 'bg-red-50 text-red-700'
                                              : val < 6
                                                ? 'bg-orange-50 text-orange-700'
                                                : 'text-indigo-800'
                                        }`}
                                      >
                                        {val === null ? '—' : formatGrade(val, 2)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-white border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm"
          >
            Listo
          </button>
        </div>

        {/* Sub-dialog: Add / Edit Criterion */}
        {editingCriterion && selectedCurriculum && (
          <CriterionEditorSubModal
            ce={selectedCurriculum.specificCompetences.find(
              (c) => c.id === editingCriterion.ceId
            )!}
            initial={editingCriterion.criterion}
            existingCount={
              selectedCurriculum.criteria.filter(
                (cr) => cr.specificCompetenceId === editingCriterion.ceId
              ).length
            }
            keyCompetences={keyCompetences}
            onSave={(draft, isNew) =>
              handleSaveCriterion(draft, isNew)
            }
            onCancel={() => setEditingCriterion(null)}
          />
        )}
      </div>
    </Modal>
  );
};

interface CriterionEditorSubModalProps {
  ce: LomloeSpecificCompetence;
  initial: LomloeCriterion | null;
  existingCount: number;
  keyCompetences: LomloeKeyCompetenceDef[];
  onSave: (criterion: LomloeCriterion, isNew: boolean) => void;
  onCancel: () => void;
}

const CriterionEditorSubModal: React.FC<CriterionEditorSubModalProps> = ({
  ce,
  initial,
  existingCount,
  keyCompetences,
  onSave,
  onCancel,
}) => {
  const [code, setCode] = useState(
    initial?.code ?? `${ce.number}.${existingCount + 1}`
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [customKcIds, setCustomKcIds] = useState<string[]>(
    initial?.keyCompetenceIds ?? []
  );

  const toggleKc = (id: string) => {
    setCustomKcIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <Modal
      open
      isNested
      onClose={onCancel}
      title={initial ? `Editar criterio ${initial.code}` : `Nuevo criterio en CE ${ce.number}`}
      maxWidthClass="w-[min(520px,95vw)]"
    >
      <div className="p-5 space-y-4">
        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Código del criterio (ej. 1.1, 3.2)
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-32 px-3 py-1.5 rounded-xl border border-slate-300 font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Redacción del criterio de evaluación
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe el criterio de evaluación..."
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Competencias clave específicas de este criterio{' '}
              <span className="font-normal text-slate-400">
                (déjalo vacío para heredar automáticamente las de CE {ce.number})
              </span>
            </label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {keyCompetences.map((kc) => {
                const active = customKcIds.includes(kc.id);
                return (
                  <button
                    key={kc.id}
                    type="button"
                    onClick={() => toggleKc(kc.id)}
                    className={`inline-flex items-center gap-1 pr-2 pl-0.5 py-0.5 rounded-full border text-[11px] font-bold transition-all ${
                      active
                        ? 'bg-indigo-50 border-indigo-400 text-indigo-900'
                        : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <LomloeCompetenceBadge competence={kc} sizePx={15} />
                    <span>{kc.code}</span>
                    {active && <Check className="w-3 h-3 text-indigo-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!code.trim() || !description.trim()}
            onClick={() => {
              const trimmedCode = code.trim();
              onSave(
                {
                  id: initial?.id ?? trimmedCode,
                  code: trimmedCode,
                  specificCompetenceId: ce.id,
                  description: description.trim(),
                  keyCompetenceIds: customKcIds.length > 0 ? customKcIds : undefined,
                },
                !initial
              );
            }}
            className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold"
          >
            Guardar criterio
          </button>
        </div>
      </div>
    </Modal>
  );
};
