import React, { useMemo } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileSpreadsheet,
  FolderKanban,
  GraduationCap,
  LayoutGrid,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { blendWithWhite, SCHOOL_DEFAULT_COLORS } from '../../constants/colors';
import { useGradebook } from '../../context/GradebookContext';
import type { ClassBook } from '../../types/gradebook';

interface SidebarProps {
  onOpenNewBook: (kind: 'CLASS' | 'TEMPLATE') => void;
  onEditBook: (book: ClassBook) => void;
  onOpenTemplateApply: (template: ClassBook) => void;
  onOpenRubricBuilder: () => void;
  onOpenLomloeManager: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onOpenNewBook,
  onEditBook,
  onOpenTemplateApply,
  onOpenRubricBuilder,
  onOpenLomloeManager,
}) => {
  const {
    workspace,
    activeBook,
    isTemplateMode,
    setActiveMode,
    selectClass,
    selectTemplate,
    deleteBook,
    saveBookAsTemplate,
    updateSettings,
  } = useGradebook();

  const collapsedSchools = workspace.settings.collapsedSchools ?? {};

  const groupedClasses = useMemo(() => {
    const groups = new Map<string, ClassBook[]>();
    const preferredOrder = ['Ribarroja', 'Manises'];

    for (const cls of workspace.classes) {
      const key = cls.school?.trim() || '__OTHER__';
      const arr = groups.get(key) ?? [];
      arr.push(cls);
      groups.set(key, arr);
    }

    const orderedKeys: string[] = [];
    for (const k of preferredOrder) {
      if (groups.has(k)) orderedKeys.push(k);
    }
    for (const k of groups.keys()) {
      if (!orderedKeys.includes(k) && k !== '__OTHER__') orderedKeys.push(k);
    }
    if (groups.has('__OTHER__')) orderedKeys.push('__OTHER__');

    return orderedKeys.map((key) => ({
      key,
      label: key === '__OTHER__' ? 'Otras clases' : key,
      classes: groups.get(key) ?? [],
    }));
  }, [workspace.classes]);

  const hasSchoolGroups = groupedClasses.some((g) => g.key !== '__OTHER__');

  if (!workspace.settings.sidebarVisible) return null;

  const renderClassCard = (cls: ClassBook) => {
    const isActive = !isTemplateMode && activeBook?.id === cls.id;
    const isRibarroja = cls.school === 'Ribarroja';
    const isManises = cls.school === 'Manises';

    const cardBg = isActive
      ? blendWithWhite(cls.color, 0.52)
      : blendWithWhite(cls.color, 0.84);
    const cardBorder = isActive
      ? isRibarroja
        ? '#F87171'
        : isManises
          ? '#60A5FA'
          : cls.color
      : blendWithWhite(cls.color, 0.35);

    return (
      <div
        key={cls.id}
        style={{
          backgroundColor: cardBg,
          borderTopColor: cardBorder,
          borderRightColor: cardBorder,
          borderBottomColor: cardBorder,
          borderLeftColor: cls.color,
        }}
        className={`group rounded-xl border border-l-4 transition-all ${
          isActive ? 'shadow-xs ring-1 ring-black/5' : 'hover:brightness-98'
        }`}
      >
        <div className="flex items-center justify-between gap-1 px-2 py-1.5">
          <button
            type="button"
            onClick={() => selectClass(cls.id)}
            className="flex-1 min-w-0 flex items-start gap-2 text-left"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 mt-1 border border-black/10"
              style={{ backgroundColor: cls.color }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-900 truncate">{cls.name}</div>
              <div className="text-[10px] text-slate-600 truncate">
                {cls.students.length} alumnos · {cls.tabs.length} pest.
              </div>
            </div>
          </button>

          <div className="flex flex-col gap-0.5 shrink-0 opacity-75 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onEditBook(cls)}
              title={`Editar clase ${cls.name}`}
              aria-label={`Editar clase ${cls.name}`}
              className="p-1 rounded-md text-slate-600 hover:text-blue-700 hover:bg-white/80"
            >
              <Pencil className="w-3 h-3" />
            </button>
            {workspace.classes.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Eliminar la clase "${cls.name}"?`)) {
                    deleteBook(cls.id);
                  }
                }}
                title={`Eliminar clase ${cls.name}`}
                aria-label={`Eliminar clase ${cls.name}`}
                className="p-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-white/80"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside
      aria-label="Menú lateral de clases y plantillas"
      className="w-[248px] shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between select-none z-20"
    >
      {/* Tabs: Clases | Plantillas */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-100">
        <div
          role="tablist"
          aria-label="Selector entre clases y plantillas"
          className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!isTemplateMode}
            onClick={() => setActiveMode('CLASS')}
            className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              !isTemplateMode
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Clases</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={isTemplateMode}
            onClick={() => setActiveMode('TEMPLATE')}
            className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              isTemplateMode
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Plantillas</span>
          </button>
        </div>
      </div>

      {/* Vertical List (Clases o Plantillas) */}
      {!isTemplateMode ? (
        <div className="flex-1 min-h-0 flex flex-col px-3 pb-2 gap-2">
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Clases ({workspace.classes.length})
            </span>
            <button
              type="button"
              onClick={() => onOpenNewBook('CLASS')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-[11px] font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nueva</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
            {hasSchoolGroups ? (
              groupedClasses.map((grp, gIdx) => {
                const isCollapsed = Boolean(collapsedSchools[grp.key]);
                const isRibarroja = grp.key === 'Ribarroja';
                const isManises = grp.key === 'Manises';
                const accentHex =
                  SCHOOL_DEFAULT_COLORS[grp.key] ?? '#CBD5E1';

                return (
                  <div
                    key={grp.key}
                    className={gIdx > 0 ? 'pt-2 border-t border-slate-200/80' : ''}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        updateSettings({
                          collapsedSchools: {
                            ...collapsedSchools,
                            [grp.key]: !isCollapsed,
                          },
                        })
                      }
                      style={{
                        backgroundColor: blendWithWhite(accentHex, 0.72),
                        borderColor: blendWithWhite(accentHex, 0.25),
                      }}
                      className={`w-full mb-1.5 px-2.5 py-1.5 rounded-xl border flex items-center justify-between gap-1.5 text-left transition-colors hover:brightness-97 ${
                        isRibarroja
                          ? 'text-rose-900'
                          : isManises
                            ? 'text-blue-900'
                            : 'text-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {isCollapsed ? (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-75" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-75" />
                        )}
                        <Building2 className="w-3.5 h-3.5 shrink-0 opacity-80" />
                        <span className="text-[11px] font-bold uppercase tracking-wider truncate">
                          {grp.label}
                        </span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded-full bg-white/80 text-[10px] font-bold tabular-nums shrink-0">
                        {grp.classes.length}
                      </span>
                    </button>

                    {!isCollapsed && (
                      <div className="space-y-1.5 pl-0.5">
                        {grp.classes.map(renderClassCard)}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="space-y-1.5">{workspace.classes.map(renderClassCard)}</div>
            )}
          </div>

          {activeBook && !activeBook.isTemplate && (
            <button
              type="button"
              onClick={() => saveBookAsTemplate(activeBook.id)}
              className="w-full py-1.5 px-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-slate-500" />
              <span>Guardar clase como plantilla</span>
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col px-3 pb-2 gap-2">
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Plantillas de clase ({workspace.templates.length})
            </span>
            <button
              type="button"
              onClick={() => onOpenNewBook('TEMPLATE')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[11px] font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nueva</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
            {workspace.templates.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500">
                Sin plantillas de clase. Crea una clase en borrador para copiar tareas, columnas y pestañas a tus clases.
              </div>
            ) : (
              workspace.templates.map((tpl) => {
                const isActive = isTemplateMode && activeBook?.id === tpl.id;
                const colCount = tpl.tabs.reduce((sum, t) => sum + t.columns.length, 0);
                return (
                  <div
                    key={tpl.id}
                    className={`rounded-xl border transition-all ${
                      isActive
                        ? 'bg-emerald-50/70 border-emerald-300 shadow-2xs'
                        : 'bg-slate-50/70 border-slate-200/70 hover:bg-slate-100/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1 p-2">
                      <button
                        type="button"
                        onClick={() => selectTemplate(tpl.id)}
                        className="flex-1 min-w-0 flex items-start gap-2 text-left"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                          style={{ backgroundColor: tpl.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-900 truncate">{tpl.name}</div>
                          <div className="text-[11px] text-slate-500 truncate">{tpl.subject}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {tpl.tabs.length} pest. · {colCount} cols.
                          </div>
                        </div>
                      </button>

                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onEditBook(tpl)}
                          title={`Editar plantilla ${tpl.name}`}
                          aria-label={`Editar plantilla ${tpl.name}`}
                          className="p-1 rounded-md text-slate-500 hover:text-blue-700 hover:bg-white"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`¿Eliminar la plantilla "${tpl.name}"?`)) {
                              deleteBook(tpl.id);
                            }
                          }}
                          title={`Eliminar plantilla ${tpl.name}`}
                          aria-label={`Eliminar plantilla ${tpl.name}`}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-white"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="px-2 pb-2">
                      <button
                        type="button"
                        onClick={() => onOpenTemplateApply(tpl)}
                        className="w-full py-1 px-2 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-700 text-slate-700 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
                      >
                        <Send className="w-3 h-3" />
                        <span>Copiar a clases...</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Footer global Rubrics & LOMLOE */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/70 space-y-2">
        <button
          type="button"
          onClick={onOpenLomloeManager}
          className="w-full py-2 px-3 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-slate-800 text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-2xs"
        >
          <GraduationCap className="w-4 h-4 text-indigo-600" />
          <span>Currículo LOMLOE</span>
        </button>
        <button
          type="button"
          onClick={onOpenRubricBuilder}
          className="w-full py-2 px-3 rounded-xl bg-white border border-slate-200 hover:border-purple-300 hover:bg-purple-50/50 text-slate-800 text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-2xs"
        >
          <LayoutGrid className="w-4 h-4 text-purple-600" />
          <span>Gestionar Rúbricas ({workspace.rubrics.length})</span>
        </button>
      </div>
    </aside>
  );
};
