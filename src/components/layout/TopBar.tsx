import React from 'react';
import {
  Cloud,
  CloudOff,
  GraduationCap,
  HardDrive,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Search,
  Sparkles,
  Undo2,
  UserCheck,
  X,
} from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';

interface TopBarProps {
  searchQuery: string;
  onChangeSearch: (q: string) => void;
  onOpenAuth: () => void;
  onOpenViewSettings: () => void;
  onOpenLomloeManager: () => void;
  onOpenBackup: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  searchQuery,
  onChangeSearch,
  onOpenAuth,
  onOpenViewSettings,
  onOpenLomloeManager,
  onOpenBackup,
}) => {
  const {
    workspace,
    activeBook,
    isTemplateMode,
    updateSettings,
    canUndo,
    undo,
    user,
    syncStatus,
    isFirebaseConfigured,
    loadDemoData,
  } = useGradebook();

  const sidebarOpen = workspace.settings.sidebarVisible;

  return (
    <header className="h-14 w-full shrink-0 bg-white border-b border-slate-200 px-3 flex items-center justify-between gap-3 flex-nowrap overflow-hidden select-none z-30">
      {/* Left zone: fixed sidebar toggle + flexible truncating class/template title */}
      <div className="flex-1 min-w-0 flex items-center gap-2.5 overflow-hidden">
        <button
          type="button"
          onClick={() => updateSettings({ sidebarVisible: !sidebarOpen })}
          title={sidebarOpen ? 'Ocultar menú lateral' : 'Mostrar menú lateral'}
          aria-label={sidebarOpen ? 'Ocultar menú lateral' : 'Mostrar menú lateral'}
          aria-pressed={sidebarOpen}
          className="w-8 h-8 shrink-0 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center justify-center transition-colors"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="w-4 h-4" />
          ) : (
            <PanelLeftOpen className="w-4 h-4" />
          )}
        </button>

        <div className="w-px h-6 bg-slate-200 shrink-0" aria-hidden="true" />

        {activeBook ? (
          <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: activeBook.color }}
            />
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center gap-2 min-w-0">
                <h1
                  title={activeBook.name}
                  className="text-sm font-bold text-slate-900 truncate leading-tight"
                >
                  {activeBook.name}
                </h1>
                {!isTemplateMode && activeBook.school && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide shrink-0 border ${
                      activeBook.school === 'Ribarroja'
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : activeBook.school === 'Manises'
                          ? 'bg-blue-50 text-blue-800 border-blue-200'
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {activeBook.school}
                  </span>
                )}
                {isTemplateMode && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wide shrink-0">
                    Plantilla
                  </span>
                )}
              </div>
              <p
                title={`${activeBook.subject} · ${activeBook.year}`}
                className="text-[11px] text-slate-500 truncate leading-tight"
              >
                {activeBook.subject || '\u00A0'}
                {activeBook.year ? ` · ${activeBook.year}` : ''}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-w-0 text-sm font-bold text-slate-700 truncate">
            Cuaderno del Profesor
          </div>
        )}
      </div>

      {/* Center zone: student search (row/header sizing moved to Aspecto & border drag) */}
      <div className="shrink-0 flex items-center gap-2">
        <div className="relative w-52 sm:w-64 shrink-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="Buscar alumno..."
            aria-label="Buscar alumno"
            className="h-8 w-full pl-8 pr-7 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onChangeSearch('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Right zone: fixed-width action buttons (exact same position always) */}
      <div className="shrink-0 flex items-center gap-1.5">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title="Deshacer último cambio (Ctrl/Cmd + Z)"
          className="w-8 sm:w-[92px] h-8 shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-medium text-slate-700 flex items-center justify-center gap-1 transition-colors"
        >
          <Undo2 className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">Deshacer</span>
        </button>

        <button
          type="button"
          onClick={onOpenLomloeManager}
          title="Currículo LOMLOE: competencias clave, específicas, criterios y resumen de la clase"
          className="w-8 sm:w-[92px] h-8 shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-xs font-medium text-slate-700 flex items-center justify-center gap-1 transition-colors"
        >
          <GraduationCap className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <span className="hidden sm:inline">LOMLOE</span>
        </button>

        <button
          type="button"
          onClick={onOpenViewSettings}
          title="Aspecto y vista del cuaderno: filas, columnas, textos e iconos"
          className="w-8 sm:w-[86px] h-8 shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center justify-center gap-1 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span className="hidden sm:inline">Aspecto</span>
        </button>

        <button
          type="button"
          onClick={onOpenBackup}
          title="Copia de seguridad y restauración del cuaderno"
          className="w-8 sm:w-[86px] h-8 shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center justify-center gap-1 transition-colors"
        >
          <HardDrive className="w-3.5 h-3.5 text-slate-600 shrink-0" />
          <span className="hidden sm:inline">Backup</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (window.confirm('¿Restaurar las clases y alumnos de demostración iniciales?')) {
              loadDemoData();
            }
          }}
          title="Restaurar datos demo"
          aria-label="Restaurar datos demo"
          className="w-8 h-8 shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onOpenAuth}
          className={`w-8 md:w-[114px] h-8 shrink-0 px-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
            user && isFirebaseConfigured
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
              : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/70'
          }`}
          title="Estado de Firebase Auth y Realtime Database"
        >
          {user && isFirebaseConfigured ? (
            <>
              <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="hidden md:inline truncate">
                {syncStatus === 'syncing'
                  ? 'Guardando...'
                  : (user.displayName?.split(' ')[0] ??
                      user.email?.split('@')[0] ??
                      'Conectado')}
              </span>
            </>
          ) : (
            <>
              {isFirebaseConfigured ? (
                <UserCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              ) : (
                <CloudOff className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
              <span className="hidden md:inline truncate">
                {isFirebaseConfigured ? 'Entrar' : 'Modo Local'}
              </span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};
