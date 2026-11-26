import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckSquare,
  FolderPlus,
  Layers,
  Pencil,
  Plus,
  Search,
  Square,
  Trash2,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { GROUP_PASTEL_SWATCHES } from '../../constants/colors';
import { useGradebook } from '../../context/GradebookContext';
import {
  ensureGroupCategories,
  getEffectiveBookGroups,
  getStudentActiveGroup,
} from '../../engine/gradeMath';
import { Modal } from '../common/Modal';

interface StudentGroupsModalProps {
  open: boolean;
  onClose: () => void;
  initialGroupName?: string | null;
}

export const StudentGroupsModal: React.FC<StudentGroupsModalProps> = ({ open, onClose }) => {
  const {
    activeBook,
    updateBook,
    createGroupCategory,
    renameGroupCategory,
    deleteGroupCategory,
    selectGroupCategory,
    upsertStudentGroup,
    deleteStudentGroup,
    assignStudentsToGroup,
  } = useGradebook();

  // Category creation / rename
  const [creatingCat, setCreatingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null);
  const [renameCatDraft, setRenameCatDraft] = useState('');

  // New group creation
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_PASTEL_SWATCHES[0]);

  // Inline rename/recolor of an existing group
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editNameDraft, setEditNameDraft] = useState('');
  const [editColorDraft, setEditColorDraft] = useState(GROUP_PASTEL_SWATCHES[0]);

  // Student multi-selection (iDoceo-style: click students -> click target group or create new)
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [studentFilter, setStudentFilter] = useState<'ALL' | 'UNASSIGNED'>('ALL');
  const [search, setSearch] = useState('');
  const [dragStudentId, setDragStudentId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const { categories, activeCategory } = useMemo(() => {
    if (!activeBook) return { categories: [], activeCategory: null };
    return ensureGroupCategories(activeBook);
  }, [activeBook]);

  const effectiveGroups = useMemo(
    () => (activeBook ? getEffectiveBookGroups(activeBook) : []),
    [activeBook]
  );

  const activeStudents = useMemo(() => {
    if (!activeBook) return [];
    return [...activeBook.students]
      .filter((s) => !s.isHidden)
      .sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName, 'es') ||
          a.firstName.localeCompare(b.firstName, 'es')
      );
  }, [activeBook]);

  useEffect(() => {
    if (!open) {
      setCreatingCat(false);
      setRenamingCatId(null);
      setEditingGroupName(null);
      setSelectedStudentIds(new Set());
      setSearch('');
      setFeedbackMsg(null);
      return;
    }
    setNewGroupColor(GROUP_PASTEL_SWATCHES[effectiveGroups.length % GROUP_PASTEL_SWATCHES.length]);
  }, [open, activeCategory?.id, effectiveGroups.length]);

  if (!activeBook || !activeCategory) return null;

  const flash = (msg: string) => {
    setFeedbackMsg(msg);
    window.setTimeout(() => setFeedbackMsg((prev) => (prev === msg ? null : prev)), 2200);
  };

  const studentGroupMap = new Map<string, string | undefined>();
  for (const s of activeStudents) {
    studentGroupMap.set(s.id, getStudentActiveGroup(s, activeBook));
  }

  const groupColorByName = new Map<string, string>();
  for (const g of effectiveGroups) {
    groupColorByName.set(g.name.trim().toLowerCase(), g.color);
  }

  const unassignedStudents = activeStudents.filter((s) => !studentGroupMap.get(s.id));

  const filteredStudents = activeStudents.filter((s) => {
    const grp = studentGroupMap.get(s.id);
    if (studentFilter === 'UNASSIGNED' && grp) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return `${s.lastName}, ${s.firstName} ${grp ?? ''}`.toLowerCase().includes(q);
  });

  const selectedArray = Array.from(selectedStudentIds).filter((id) =>
    activeStudents.some((s) => s.id === id)
  );
  const selectedCount = selectedArray.length;

  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const selectFilteredUnassigned = () => {
    setSelectedStudentIds(new Set(unassignedStudents.map((s) => s.id)));
  };

  const selectAllVisible = () => {
    setSelectedStudentIds(new Set(filteredStudents.map((s) => s.id)));
  };

  const clearSelection = () => {
    setSelectedStudentIds(new Set());
  };

  const handleAssignSelectedToGroup = (groupName: string) => {
    if (selectedCount === 0) return;
    assignStudentsToGroup(selectedArray, groupName);
    flash(
      `${selectedCount} ${selectedCount === 1 ? 'alumno asignado' : 'alumnos asignados'} a "${groupName}"`
    );
    setSelectedStudentIds(new Set());
  };

  const handleUnassignSelected = () => {
    if (selectedCount === 0) return;
    assignStudentsToGroup(selectedArray, undefined);
    flash(
      `${selectedCount} ${selectedCount === 1 ? 'alumno quitado' : 'alumnos quitados'} de su grupo`
    );
    setSelectedStudentIds(new Set());
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newCatName.trim();
    if (!clean) return;
    createGroupCategory(clean);
    setNewCatName('');
    setCreatingCat(false);
    setSelectedStudentIds(new Set());
    flash(`Categoría "${clean}" creada`);
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newGroupName.trim();
    if (!clean) return;
    upsertStudentGroup(clean, newGroupColor);
    if (selectedCount > 0) {
      assignStudentsToGroup(selectedArray, clean);
      flash(`Grupo "${clean}" creado con ${selectedCount} alumnos`);
      setSelectedStudentIds(new Set());
    } else {
      flash(`Grupo "${clean}" creado`);
    }
    setNewGroupName('');
    setNewGroupColor(
      GROUP_PASTEL_SWATCHES[(effectiveGroups.length + 1) % GROUP_PASTEL_SWATCHES.length]
    );
  };

  const startEditGroup = (name: string, color: string) => {
    setEditingGroupName(name);
    setEditNameDraft(name);
    setEditColorDraft(color);
  };

  const commitEditGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroupName) return;
    const clean = editNameDraft.trim();
    if (!clean) return;
    upsertStudentGroup(clean, editColorDraft, editingGroupName);
    setEditingGroupName(null);
  };

  const spacerRows = activeBook.groupSpacerRows ?? 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Grupos y Categorías · ${activeBook.name}`}
      subtitle="Selecciona alumnos en la lista o dentro de cualquier grupo para asignarlos, moverlos o quitarlos"
      maxWidthClass="w-[min(1000px,96vw)]"
      notice={feedbackMsg}
      headerActions={
        <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={Boolean(activeBook.groupByGroups)}
            onChange={(e) => updateBook(activeBook.id, { groupByGroups: e.target.checked })}
            className="accent-indigo-600"
          />
          <span>Ver por grupos</span>
        </label>
      }
    >
      <div className="p-4 space-y-3 text-xs">
        {/* Category Switcher Bar */}
        <div className="p-2.5 rounded-2xl border border-indigo-200/80 bg-indigo-50/45 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="text-[11px] font-bold text-indigo-900 flex items-center gap-1 mr-1">
              <Layers className="w-3.5 h-3.5" />
              <span>Categoría:</span>
            </span>

            {categories.map((cat) => {
              const isAct = cat.id === activeCategory.id;
              if (renamingCatId === cat.id) {
                return (
                  <form
                    key={cat.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renameCatDraft.trim()) renameGroupCategory(cat.id, renameCatDraft.trim());
                      setRenamingCatId(null);
                    }}
                    className="inline-flex items-center gap-1 bg-white rounded-xl px-2 py-1 border border-indigo-400"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={renameCatDraft}
                      onChange={(e) => setRenameCatDraft(e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      aria-label="Nombre de la categoría"
                      className="w-36 min-h-[28px] select-text text-sm sm:text-xs font-semibold text-slate-900 bg-transparent focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="p-0.5 text-emerald-700 hover:bg-emerald-50 rounded"
                      title="Guardar nombre"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingCatId(null)}
                      className="p-0.5 text-slate-400 hover:text-slate-700 rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                );
              }

              return (
                <div
                  key={cat.id}
                  className={`inline-flex items-center rounded-xl border transition-all ${
                    isAct
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      selectGroupCategory(cat.id);
                      setSelectedStudentIds(new Set());
                    }}
                    className="px-2.5 py-1 font-semibold text-[11px]"
                  >
                    {cat.name}
                  </button>
                  {isAct && (
                    <div className="flex items-center pr-1 gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingCatId(cat.id);
                          setRenameCatDraft(cat.name);
                        }}
                        title="Renombrar categoría"
                        className="p-0.5 rounded hover:bg-white/20 text-white/90"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      {categories.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`¿Eliminar la categoría "${cat.name}"?`)) {
                              deleteGroupCategory(cat.id);
                            }
                          }}
                          title="Eliminar categoría"
                          className="p-0.5 rounded hover:bg-white/20 text-white/90"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {creatingCat ? (
              <form
                onSubmit={handleCreateCategory}
                className="inline-flex items-center gap-1.5 bg-white rounded-xl px-2 py-1 border border-indigo-400"
              >
                <input
                  type="text"
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  placeholder="Ej: Proyecto, Mesas..."
                  aria-label="Nueva categoría"
                  className="w-40 min-h-[28px] select-text text-sm sm:text-xs text-slate-900 bg-transparent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newCatName.trim()}
                  className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-40"
                >
                  Crear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingCat(false);
                    setNewCatName('');
                  }}
                  className="p-0.5 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreatingCat(true)}
                className="px-2.5 py-1 rounded-xl border border-dashed border-indigo-300 bg-white/80 hover:bg-white text-indigo-700 font-semibold flex items-center gap-1 text-[11px]"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Nueva categoría</span>
              </button>
            )}
          </div>

          {/* Empty spacer rows selector */}
          <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <span className="font-semibold">Filas vacías entre grupos:</span>
            {[0, 1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => updateBook(activeBook.id, { groupSpacerRows: n })}
                className={`w-6 h-6 rounded-lg font-bold border transition-colors ${
                  spacerRows === n
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Live Action Banner (static layout; transient feedback uses floating popup) */}
        <div
          className={`px-3 py-2 rounded-xl border flex flex-wrap items-center justify-between gap-2 transition-colors ${
            selectedCount > 0
              ? 'bg-blue-50 border-blue-300 text-blue-950'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}
        >
          {selectedCount > 0 ? (
            <>
              <div className="flex items-center gap-2 font-semibold">
                <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white font-bold tabular-nums">
                  {selectedCount}
                </span>
                <span>
                  {selectedCount === 1
                    ? 'alumno seleccionado — pulsa "Mover aquí" en un grupo, crea uno nuevo o quítalo'
                    : 'alumnos seleccionados — pulsa "Mover aquí" en un grupo, crea uno nuevo o quítalos'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleUnassignSelected}
                  className="px-2.5 py-1 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 font-semibold flex items-center gap-1"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                  <span>Quitar de su grupo</span>
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 font-semibold"
                >
                  Limpiar
                </button>
              </div>
            </>
          ) : (
            <span>
              Haz clic en los alumnos (en la lista o dentro de cualquier grupo) para seleccionarlos, cambiarlos de grupo o quitarlos.
            </span>
          )}
        </div>

        {/* Main 2-column iDoceo board: Left = Click-to-Select Students · Right = Full Group Cards List */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-start">
          {/* LEFT: Student Picker (multi-select with 1 click) */}
          <div className="md:col-span-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-500" />
                <span>Alumnos ({activeStudents.length})</span>
              </span>
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[10.5px]">
                <button
                  type="button"
                  onClick={() => setStudentFilter('ALL')}
                  className={`px-2 py-0.5 rounded-md font-semibold ${
                    studentFilter === 'ALL'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setStudentFilter('UNASSIGNED')}
                  className={`px-2 py-0.5 rounded-md font-semibold ${
                    studentFilter === 'UNASSIGNED'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Sin grupo ({unassignedStudents.length})
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar alumno..."
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <button
                type="button"
                onClick={selectFilteredUnassigned}
                disabled={unassignedStudents.length === 0}
                title="Seleccionar todos los alumnos sin grupo"
                className="px-2 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 text-[10.5px] font-semibold text-slate-700 shrink-0"
              >
                Sin grupo
              </button>
              <button
                type="button"
                onClick={selectAllVisible}
                disabled={filteredStudents.length === 0}
                title="Seleccionar todos los alumnos listados"
                className="px-2 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 text-[10.5px] font-semibold text-slate-700 shrink-0"
              >
                Todos
              </button>
            </div>

            <div className="max-h-[48dvh] md:max-h-[460px] overflow-y-auto space-y-1 pr-0.5">
              {filteredStudents.length === 0 ? (
                <div className="py-10 text-center text-slate-400 italic">
                  {studentFilter === 'UNASSIGNED'
                    ? '¡Todos los alumnos tienen grupo!'
                    : 'No se encontraron alumnos.'}
                </div>
              ) : (
                filteredStudents.map((st) => {
                  const grp = studentGroupMap.get(st.id);
                  const grpColor = grp ? groupColorByName.get(grp.trim().toLowerCase()) : undefined;
                  const isSel = selectedStudentIds.has(st.id);

                  return (
                    <button
                      key={st.id}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        setDragStudentId(st.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', st.id);
                      }}
                      onDragEnd={() => {
                        setDragStudentId(null);
                        setDragOverGroup(null);
                      }}
                      onClick={() => toggleStudentSelection(st.id)}
                      className={`w-full px-2.5 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-all ${
                        isSel
                          ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-300 shadow-2xs'
                          : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isSel ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-800 truncate">
                          {st.lastName}, {st.firstName}
                        </span>
                      </div>
                      {grp ? (
                        <span
                          style={{ backgroundColor: grpColor ?? '#E2E8F0' }}
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold text-slate-800 border border-black/10 shrink-0 max-w-[110px] truncate"
                        >
                          {grp}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 shrink-0">Sin grupo</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT: Create New Group + Full Vertical List of Groups & All Their Members */}
          <div className="md:col-span-7 flex flex-col gap-2.5 min-w-0">
            {/* Inline Create Group Bar */}
            <form
              onSubmit={handleCreateGroup}
              className="p-2.5 rounded-2xl border border-slate-200 bg-white flex flex-wrap items-center gap-2 shadow-2xs shrink-0"
            >
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                placeholder={
                  selectedCount > 0
                    ? `Crear grupo nuevo y meter a los ${selectedCount} seleccionados...`
                    : 'Nuevo grupo (ej: Grupo 1, Mesa A, Equipo Azul)...'
                }
                aria-label="Nombre del nuevo grupo"
                className="flex-1 min-w-[170px] min-h-[36px] select-text border border-slate-300 rounded-xl px-3 py-1.5 bg-white text-sm sm:text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/25"
              />
              <div className="flex items-center gap-1">
                {GROUP_PASTEL_SWATCHES.slice(0, 6).map((sw) => (
                  <button
                    key={sw}
                    type="button"
                    onClick={() => setNewGroupColor(sw)}
                    style={{ backgroundColor: sw }}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${
                      newGroupColor === sw
                        ? 'border-slate-900 scale-110'
                        : 'border-black/10 hover:scale-105'
                    }`}
                    title="Color del nuevo grupo"
                  />
                ))}
              </div>
              <button
                type="submit"
                disabled={!newGroupName.trim()}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{selectedCount > 0 ? `Crear y asignar (${selectedCount})` : 'Crear grupo'}</span>
              </button>
            </form>

            {/* Group Cards List: always 1 full-width card per row so every group & all members remain 100% visible */}
            <div className="flex flex-col gap-3 max-h-[54dvh] md:max-h-[465px] overflow-y-auto pr-1">
              {effectiveGroups.length === 0 ? (
                <div className="py-12 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 text-center text-slate-500 shrink-0">
                  Aún no hay grupos en <strong>{activeCategory.name}</strong>.
                  <br />
                  Escribe un nombre arriba y pulsa <strong>Crear grupo</strong>.
                </div>
              ) : (
                effectiveGroups.map((grp) => {
                  const members = activeStudents.filter(
                    (s) =>
                      (studentGroupMap.get(s.id) ?? '').trim().toLowerCase() ===
                      grp.name.trim().toLowerCase()
                  );
                  const isDragOver = dragOverGroup === grp.name;
                  const isEditingThis = editingGroupName === grp.name;
                  const allMembersSelected =
                    members.length > 0 && members.every((m) => selectedStudentIds.has(m.id));
                  const selectedInThisGroup = members.filter((m) =>
                    selectedStudentIds.has(m.id)
                  ).length;

                  const toggleSelectWholeGroup = () => {
                    setSelectedStudentIds((prev) => {
                      const next = new Set(prev);
                      if (allMembersSelected) {
                        for (const m of members) next.delete(m.id);
                      } else {
                        for (const m of members) next.add(m.id);
                      }
                      return next;
                    });
                  };

                  return (
                    <div
                      key={grp.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverGroup(grp.name);
                      }}
                      onDragLeave={() => {
                        if (dragOverGroup === grp.name) setDragOverGroup(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const sid = dragStudentId || e.dataTransfer.getData('text/plain');
                        if (sid) {
                          const toMove = selectedStudentIds.has(sid) ? selectedArray : [sid];
                          assignStudentsToGroup(toMove, grp.name);
                          setSelectedStudentIds(new Set());
                          flash(
                            `${toMove.length} ${toMove.length === 1 ? 'alumno movido' : 'alumnos movidos'} a "${grp.name}"`
                          );
                        }
                        setDragStudentId(null);
                        setDragOverGroup(null);
                      }}
                      className={`shrink-0 rounded-2xl border bg-white flex flex-col transition-all ${
                        isDragOver
                          ? 'border-blue-500 ring-2 ring-blue-300 shadow-md'
                          : selectedCount > 0 && !isEditingThis
                            ? 'border-blue-300 shadow-xs'
                            : 'border-slate-200'
                      }`}
                    >
                      {/* Group Card Header (click when students selected assigns them here) */}
                      <div
                        style={{ backgroundColor: grp.color }}
                        onClick={() => {
                          if (!isEditingThis && selectedCount > 0) {
                            handleAssignSelectedToGroup(grp.name);
                          }
                        }}
                        className={`px-3 py-2 rounded-t-2xl border-b border-black/10 flex flex-wrap items-center justify-between gap-2 ${
                          selectedCount > 0 && !isEditingThis ? 'cursor-pointer hover:brightness-97' : ''
                        }`}
                      >
                        {isEditingThis ? (
                          <form
                            onSubmit={commitEditGroup}
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            className="flex-1 flex flex-wrap items-center gap-1.5"
                          >
                            <input
                              type="text"
                              autoFocus
                              value={editNameDraft}
                              onChange={(e) => setEditNameDraft(e.target.value)}
                              onPointerDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              aria-label="Editar nombre del grupo"
                              className="flex-1 min-w-[110px] min-h-[34px] select-text bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-sm sm:text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                            />
                            <div className="flex items-center gap-0.5">
                              {GROUP_PASTEL_SWATCHES.slice(0, 6).map((sw) => (
                                <button
                                  key={sw}
                                  type="button"
                                  onClick={() => setEditColorDraft(sw)}
                                  style={{ backgroundColor: sw }}
                                  className={`w-4 h-4 rounded-full border ${
                                    editColorDraft === sw ? 'border-slate-900' : 'border-black/15'
                                  }`}
                                />
                              ))}
                            </div>
                            <button
                              type="submit"
                              className="p-1 rounded-lg bg-slate-900 text-white"
                              title="Guardar"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingGroupName(null)}
                              className="p-1 rounded-lg bg-white/80 text-slate-600"
                              title="Cancelar"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </form>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-bold text-slate-900 break-words">{grp.name}</span>
                              <span className="px-2 py-0.5 rounded-full bg-white/80 text-slate-700 text-[10px] font-bold tabular-nums shrink-0">
                                {members.length} {members.length === 1 ? 'alumno' : 'alumnos'}
                              </span>
                              {selectedInThisGroup > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold tabular-nums shrink-0">
                                  {selectedInThisGroup} sel.
                                </span>
                              )}
                            </div>

                            <div
                              className="flex items-center gap-1 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {members.length > 0 && (
                                <button
                                  type="button"
                                  onClick={toggleSelectWholeGroup}
                                  title={
                                    allMembersSelected
                                      ? `Deseleccionar los ${members.length} alumnos de "${grp.name}"`
                                      : `Seleccionar todos los alumnos de "${grp.name}"`
                                  }
                                  className={`px-2 py-1 rounded-lg border text-[10.5px] font-semibold transition-colors ${
                                    allMembersSelected
                                      ? 'bg-blue-600 border-blue-600 text-white'
                                      : 'bg-white/80 border-black/10 text-slate-700 hover:bg-white'
                                  }`}
                                >
                                  {allMembersSelected ? 'Deselec.' : 'Sel. grupo'}
                                </button>
                              )}

                              {selectedCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleAssignSelectedToGroup(grp.name)}
                                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10.5px] font-bold shadow-2xs"
                                >
                                  Mover aquí ({selectedCount})
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => startEditGroup(grp.name, grp.color)}
                                title="Editar nombre y color"
                                className="p-1 rounded-lg hover:bg-white/70 text-slate-700"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `¿Eliminar el grupo "${grp.name}"? Los alumnos quedarán sin grupo.`
                                    )
                                  ) {
                                    deleteStudentGroup(grp.name);
                                  }
                                }}
                                title="Eliminar grupo"
                                className="p-1 rounded-lg hover:bg-rose-100 text-rose-700"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Group Members List: NEVER clips or shrinks; displays 100% of members below the header */}
                      <div className="p-2.5 bg-slate-50/70 rounded-b-2xl flex flex-col gap-1.5">
                        {members.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!isEditingThis && selectedCount > 0) {
                                handleAssignSelectedToGroup(grp.name);
                              }
                            }}
                            disabled={selectedCount === 0 || isEditingThis}
                            className={`w-full py-3 px-2 rounded-xl border border-dashed text-[11px] italic text-center transition-colors ${
                              selectedCount > 0 && !isEditingThis
                                ? 'border-blue-300 bg-blue-50/60 hover:bg-blue-100/70 text-blue-700 font-semibold not-italic cursor-pointer'
                                : 'border-slate-200 text-slate-400 cursor-default'
                            }`}
                          >
                            {selectedCount > 0
                              ? `Pulsa aquí para meter a los ${selectedCount} alumnos seleccionados`
                              : 'Sin alumnos aún'}
                          </button>
                        ) : (
                          members.map((st, idx) => {
                            const isMemberSelected = selectedStudentIds.has(st.id);
                            return (
                              <div
                                key={st.id}
                                draggable
                                onDragStart={(e) => {
                                  setDragStudentId(st.id);
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', st.id);
                                }}
                                onDragEnd={() => {
                                  setDragStudentId(null);
                                  setDragOverGroup(null);
                                }}
                                className={`w-full rounded-xl border flex items-stretch gap-1 transition-all ${
                                  isMemberSelected
                                    ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-300 shadow-2xs'
                                    : 'bg-white border-slate-200 hover:border-blue-300'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleStudentSelection(st.id)}
                                  title="Seleccionar alumno para cambiarlo de grupo o quitarlo"
                                  className="flex-1 min-w-0 px-2.5 py-2 text-left flex items-center gap-2"
                                >
                                  {isMemberSelected ? (
                                    <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-300 shrink-0" />
                                  )}
                                  <span className="text-[10.5px] font-bold text-slate-400 tabular-nums shrink-0">
                                    {idx + 1}.
                                  </span>
                                  <span className="font-semibold text-slate-800 leading-snug break-words">
                                    {st.lastName}, {st.firstName}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    assignStudentsToGroup([st.id], undefined);
                                    setSelectedStudentIds((prev) => {
                                      if (!prev.has(st.id)) return prev;
                                      const next = new Set(prev);
                                      next.delete(st.id);
                                      return next;
                                    });
                                    flash(`"${st.lastName}, ${st.firstName}" quitado de "${grp.name}"`);
                                  }}
                                  title={`Quitar a ${st.lastName}, ${st.firstName} de "${grp.name}"`}
                                  aria-label={`Quitar a ${st.lastName}, ${st.firstName} de ${grp.name}`}
                                  className="px-2.5 py-1.5 rounded-r-xl text-slate-400 hover:text-rose-700 hover:bg-rose-50 border-l border-slate-100 flex items-center gap-1 text-[10.5px] font-semibold shrink-0 transition-colors"
                                >
                                  <UserMinus className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">Quitar</span>
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold"
          >
            Listo
          </button>
        </div>
      </div>
    </Modal>
  );
};
