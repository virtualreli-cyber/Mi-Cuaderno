import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  Download,
  FileSpreadsheet,
  GraduationCap,
  HardDrive,
  History,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Search,
  Sparkles,
  Undo2,
  UserCheck,
  WifiOff,
  X,
} from 'lucide-react';
import { blendWithWhite, SCHOOL_DEFAULT_COLORS } from '../../constants/colors';
import { useGradebook } from '../../context/GradebookContext';
import { useDeviceProfile } from '../../hooks/useDeviceProfile';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { usePwaUpdateStatus } from '../../services/pwaUpdater';
import type { ClassBook } from '../../types/gradebook';

interface TopBarProps {
  searchQuery: string;
  onChangeSearch: (q: string) => void;
  drawerOpen?: boolean;
  onToggleDrawer?: () => void;
  onOpenAuth: () => void;
  onOpenViewSettings: () => void;
  onOpenLomloeManager: () => void;
  onOpenBackup: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  searchQuery,
  onChangeSearch,
  drawerOpen = false,
  onToggleDrawer,
  onOpenAuth,
  onOpenViewSettings,
  onOpenLomloeManager,
  onOpenBackup,
}) => {
  const device = useDeviceProfile();
  const pwa = usePwaInstall();
  const {
    workspace,
    activeBook,
    isTemplateMode,
    updateSettings,
    selectClass,
    selectTemplate,
    canUndo,
    undo,
    canUndoAspect,
    undoAspect,
    user,
    syncStatus,
    isOnline,
    hasPendingSync,
    syncConflicts,
    isFirebaseConfigured,
    autoBackup,
    loadDemoData,
  } = useGradebook();

  const pwaUpdate = usePwaUpdateStatus();
  const sidebarOpen = device.isOverlaySidebar ? drawerOpen : workspace.settings.sidebarVisible;
  const [classMenuOpen, setClassMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 56, left: 60 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (mobileMoreRef.current?.contains(e.target as Node)) return;
      setMobileMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMoreOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileMoreOpen]);

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

  const updateMenuPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 310;
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.left));
    const top = Math.min(window.innerHeight - 160, rect.bottom + 6);
    setMenuPos({ top, left });
  };

  useEffect(() => {
    if (!classMenuOpen) return;
    updateMenuPosition();

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setClassMenuOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setClassMenuOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updateMenuPosition);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [classMenuOpen]);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []
    );
    if (items.length === 0) return;
    e.preventDefault();
    const cur = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = cur < 0 ? 0 : (cur + 1) % items.length;
    else if (e.key === 'ArrowUp') next = cur <= 0 ? items.length - 1 : cur - 1;
    items[next]?.focus({ preventScroll: true });
  };

  const iconBtnSize = device.isTouch ? 'w-10 h-10' : 'w-8 h-8';
  const syncHasAlert = syncConflicts.length > 0 || !isOnline || (hasPendingSync && Boolean(user));

  return (
    <header
      style={{
        paddingTop: 'var(--safe-top)',
        paddingLeft: 'max(0.75rem, var(--safe-left))',
        paddingRight: 'max(0.75rem, var(--safe-right))',
      }}
      className="min-h-14 w-full shrink-0 bg-white border-b border-slate-200 flex items-center justify-between gap-2 sm:gap-3 flex-nowrap overflow-hidden select-none z-40 relative"
    >
      {/* Left zone: fixed sidebar toggle + flexible truncating class/template title */}
      <div className="flex-1 min-w-0 flex items-center gap-2 sm:gap-2.5 overflow-hidden">
        <button
          type="button"
          onClick={() => {
            if (device.isOverlaySidebar && onToggleDrawer) {
              onToggleDrawer();
            } else {
              updateSettings({ sidebarVisible: !sidebarOpen });
            }
          }}
          title={sidebarOpen ? 'Ocultar menú lateral' : 'Mostrar menú lateral'}
          aria-label={sidebarOpen ? 'Ocultar menú lateral' : 'Mostrar menú lateral'}
          aria-pressed={sidebarOpen}
          className={`${iconBtnSize} shrink-0 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center justify-center transition-colors`}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
          )}
        </button>

        <div className="w-px h-6 bg-slate-200 shrink-0" aria-hidden="true" />

        {activeBook ? (
          <div className="flex-1 min-w-0 flex items-center overflow-hidden">
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={classMenuOpen}
              aria-controls="topbar-class-menu"
              onClick={() => {
                if (!classMenuOpen) updateMenuPosition();
                setClassMenuOpen((v) => !v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  updateMenuPosition();
                  setClassMenuOpen(true);
                  requestAnimationFrame(() => {
                    menuRef.current
                      ?.querySelector<HTMLButtonElement>('button[role="menuitem"]')
                      ?.focus({ preventScroll: true });
                  });
                }
              }}
              title="Cambiar de clase o plantilla"
              className={`min-w-0 max-w-full flex items-center gap-2 px-2 py-1 rounded-xl text-left transition-colors overflow-hidden ${
                classMenuOpen ? 'bg-slate-100 ring-1 ring-slate-200' : 'hover:bg-slate-100/80'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                style={{ backgroundColor: activeBook.color }}
              />
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h1 className="text-sm font-bold text-slate-900 truncate leading-tight min-w-0">
                    {activeBook.name}
                  </h1>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                      classMenuOpen ? 'rotate-180 text-blue-600' : ''
                    }`}
                    aria-hidden="true"
                  />
                  {!isTemplateMode && activeBook.school && (
                    <span
                      className={`hidden xl:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide shrink-0 border ${
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
                    <span className="hidden xl:inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wide shrink-0">
                      Plantilla
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate leading-tight">
                  {activeBook.subject || '\u00A0'}
                  {activeBook.year ? ` · ${activeBook.year}` : ''}
                </p>
              </div>
            </button>

            {classMenuOpen &&
              createPortal(
                <div
                  ref={menuRef}
                  id="topbar-class-menu"
                  role="menu"
                  aria-label="Cambiar de clase o plantilla"
                  onKeyDown={handleMenuKeyDown}
                  style={{ top: menuPos.top, left: menuPos.left }}
                  className="fixed z-50 w-[310px] max-h-[min(72vh,540px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl p-2 space-y-2.5 text-xs select-none"
                >
                  {groupedClasses.map((grp) => {
                    const accentHex = SCHOOL_DEFAULT_COLORS[grp.key] ?? '#CBD5E1';
                    return (
                      <div key={grp.key} className="space-y-1">
                        <div
                          style={{
                            backgroundColor: blendWithWhite(accentHex, 0.72),
                            borderColor: blendWithWhite(accentHex, 0.35),
                          }}
                          className="px-2.5 py-1 rounded-lg border flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider text-slate-700"
                        >
                          <span className="flex items-center gap-1.5">
                            <Building2 className="w-3 h-3 opacity-75" />
                            <span>{grp.label}</span>
                          </span>
                          <span className="text-[10px] tabular-nums opacity-75">
                            {grp.classes.length}
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {grp.classes.map((cls) => {
                            const isCurrent = !isTemplateMode && activeBook.id === cls.id;
                            return (
                              <button
                                key={cls.id}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  selectClass(cls.id);
                                  setClassMenuOpen(false);
                                  triggerRef.current?.focus({ preventScroll: true });
                                }}
                                style={{
                                  backgroundColor: isCurrent
                                    ? blendWithWhite(cls.color, 0.55)
                                    : undefined,
                                }}
                                className={`w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2 text-left transition-colors ${
                                  isCurrent
                                    ? 'font-bold text-slate-900 ring-1 ring-blue-300'
                                    : 'text-slate-700 hover:bg-slate-100 font-medium'
                                }`}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                                    style={{ backgroundColor: cls.color }}
                                  />
                                  <span className="truncate">{cls.name}</span>
                                </span>
                                <span className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-[10px] text-slate-400 tabular-nums">
                                    {cls.students.length} al.
                                  </span>
                                  {isCurrent && <Check className="w-3.5 h-3.5 text-blue-600" />}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {workspace.templates.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-200 space-y-1">
                      <div className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider text-emerald-800">
                        <span className="flex items-center gap-1.5">
                          <FileSpreadsheet className="w-3 h-3" />
                          <span>Plantillas</span>
                        </span>
                        <span className="text-[10px] tabular-nums">{workspace.templates.length}</span>
                      </div>
                      <div className="space-y-0.5">
                        {workspace.templates.map((tpl) => {
                          const isCurrent = isTemplateMode && activeBook.id === tpl.id;
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                selectTemplate(tpl.id);
                                setClassMenuOpen(false);
                                triggerRef.current?.focus({ preventScroll: true });
                              }}
                              className={`w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2 text-left transition-colors ${
                                isCurrent
                                  ? 'bg-emerald-50 font-bold text-emerald-950 ring-1 ring-emerald-300'
                                  : 'text-slate-700 hover:bg-slate-100 font-medium'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                                  style={{ backgroundColor: tpl.color }}
                                />
                                <span className="truncate">{tpl.name}</span>
                              </span>
                              {isCurrent && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>,
                document.body
              )}
          </div>
        ) : (
          <div className="flex-1 min-w-0 text-sm font-bold text-slate-700 truncate">
            Cuaderno del Profesor
          </div>
        )}
      </div>

      {/* Center zone: student search (inline on Desktop/Tablet; expandable overlay on Mobile) */}
      {!device.isMobile && (
        <div className="shrink-0 flex items-center gap-2">
          <div className="relative w-32 sm:w-44 lg:w-56 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onChangeSearch(e.target.value)}
              placeholder="Buscar alumno..."
              aria-label="Buscar alumno"
              className={`${device.isTouch ? 'h-10 text-sm' : 'h-8 text-xs'} w-full pl-8 pr-7 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onChangeSearch('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Right zone: Desktop/Tablet compact icon toolbar OR Mobile streamlined toolbar + overflow menu */}
      {device.isMobile ? (
        <div
          role="toolbar"
          aria-label="Acciones del cuaderno"
          className="shrink-0 flex items-center gap-1"
        >
          <button
            type="button"
            onClick={() => setMobileSearchOpen((v) => !v)}
            aria-label="Buscar alumno"
            aria-pressed={mobileSearchOpen || Boolean(searchQuery)}
            className={`w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center transition-colors ${
              mobileSearchOpen || searchQuery
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            <Search className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="Deshacer último cambio de datos"
            aria-label="Deshacer último cambio de datos"
            data-data-undo-btn="topbar"
            className="w-10 h-10 shrink-0 rounded-xl border border-slate-200 bg-white disabled:opacity-35 text-slate-700 flex items-center justify-center"
          >
            <Undo2 className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setMobileMoreOpen((v) => !v)}
            aria-label="Más opciones del cuaderno"
            aria-expanded={mobileMoreOpen}
            aria-haspopup="menu"
            data-mobile-overflow-btn="true"
            className={`relative w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center transition-colors ${
              mobileMoreOpen
                ? 'bg-slate-100 border-slate-300 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
            {syncHasAlert && (
              <span
                aria-hidden="true"
                className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                  syncConflicts.length > 0 ? 'bg-rose-500' : 'bg-amber-500'
                }`}
              />
            )}
          </button>

          {mobileSearchOpen &&
            createPortal(
              <div
                style={{ top: 'calc(3.5rem + var(--safe-top))' }}
                className="fixed left-0 right-0 z-50 bg-white border-b border-slate-200 shadow-lg px-3 py-2 flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                  <input
                    type="search"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => onChangeSearch(e.target.value)}
                    placeholder="Buscar alumno..."
                    aria-label="Buscar alumno"
                    className="h-11 w-full pl-9 pr-9 text-sm rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => onChangeSearch('')}
                      aria-label="Limpiar búsqueda"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMobileSearchOpen(false)}
                  className="h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700"
                >
                  Cerrar
                </button>
              </div>,
              document.body
            )}

          {mobileMoreOpen &&
            createPortal(
              <div
                ref={mobileMoreRef}
                role="menu"
                aria-label="Más acciones del cuaderno"
                style={{ top: 'calc(3.6rem + var(--safe-top))', right: 'max(0.75rem, var(--safe-right))' }}
                className="fixed z-[80] w-64 rounded-2xl border border-slate-200 bg-white shadow-2xl py-1.5 text-sm font-medium text-slate-800"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canUndoAspect}
                  data-aspect-undo-btn="topbar"
                  onClick={() => {
                    undoAspect();
                    setMobileMoreOpen(false);
                  }}
                  className="w-full min-h-[44px] px-3.5 flex items-center gap-3 hover:bg-slate-50 disabled:opacity-40 text-left"
                >
                  <History className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden="true" />
                  <span>Deshacer aspecto</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMobileMoreOpen(false);
                    onOpenLomloeManager();
                  }}
                  className="w-full min-h-[44px] px-3.5 flex items-center gap-3 hover:bg-slate-50 text-left"
                >
                  <GraduationCap className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden="true" />
                  <span>Currículo LOMLOE</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMobileMoreOpen(false);
                    onOpenViewSettings();
                  }}
                  className="w-full min-h-[44px] px-3.5 flex items-center gap-3 hover:bg-slate-50 text-left"
                >
                  <Sparkles className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>Aspecto y vista</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMobileMoreOpen(false);
                    onOpenBackup();
                  }}
                  className="w-full min-h-[44px] px-3.5 flex items-center gap-3 hover:bg-slate-50 text-left"
                >
                  <HardDrive className="w-4 h-4 text-slate-600 shrink-0" aria-hidden="true" />
                  <span>Copia de seguridad</span>
                </button>
                {pwa.canPromptInstall && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      void pwa.triggerInstall();
                    }}
                    className="w-full min-h-[44px] px-3.5 flex items-center gap-3 hover:bg-blue-50 text-blue-700 font-semibold text-left"
                  >
                    <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Instalar app</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMobileMoreOpen(false);
                    onOpenAuth();
                  }}
                  className="w-full min-h-[44px] px-3.5 flex items-center justify-between gap-2 hover:bg-slate-50 text-left"
                >
                  <span className="flex items-center gap-3">
                    {!isOnline ? (
                      <WifiOff className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                    ) : user && isFirebaseConfigured ? (
                      <Cloud className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                    ) : (
                      <UserCheck className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
                    )}
                    <span>Cuenta y sincronización</span>
                  </span>
                  {syncHasAlert && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                      {syncConflicts.length > 0 ? `${syncConflicts.length}` : 'Offline'}
                    </span>
                  )}
                </button>
                <div className="my-1 border-t border-slate-100" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMobileMoreOpen(false);
                    if (window.confirm('¿Restaurar las clases y alumnos de demostración iniciales?')) {
                      loadDemoData();
                    }
                  }}
                  className="w-full min-h-[44px] px-3.5 flex items-center gap-3 hover:bg-slate-50 text-slate-600 text-left"
                >
                  <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Restaurar datos demo</span>
                </button>
              </div>,
              document.body
            )}
        </div>
      ) : (
        <div
          role="toolbar"
          aria-label="Acciones del cuaderno"
          className="shrink-0 flex items-center gap-1"
        >
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="Deshacer último cambio de datos y notas (Ctrl/Cmd + Z)"
            aria-label="Deshacer último cambio de datos"
            data-data-undo-btn="topbar"
            className={`${iconBtnSize} shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-35 text-slate-700 flex items-center justify-center transition-colors`}
          >
            <Undo2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={undoAspect}
            disabled={!canUndoAspect}
            title="Deshacer último cambio de aspecto (tamaños, zoom, filas, columnas)"
            aria-label="Deshacer último cambio de aspecto"
            data-aspect-undo-btn="topbar"
            className={`${iconBtnSize} shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-35 text-indigo-600 flex items-center justify-center transition-colors`}
          >
            <History className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenLomloeManager}
            title="Currículo LOMLOE: competencias clave, específicas, criterios y resumen de la clase"
            aria-label="Currículo LOMLOE"
            className={`${iconBtnSize} shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-indigo-600 flex items-center justify-center transition-colors`}
          >
            <GraduationCap className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenViewSettings}
            title="Aspecto y vista del cuaderno: filas, columnas, textos e iconos"
            aria-label="Aspecto y vista del cuaderno"
            className={`${iconBtnSize} shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-blue-600 flex items-center justify-center transition-colors`}
          >
            <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenBackup}
            title={
              autoBackup.status === 'ACTIVE' || autoBackup.status === 'SAVING'
                ? `Copia automática activa en «${autoBackup.folderName}» (Mi Cuaderno.json)`
                : autoBackup.status === 'NEEDS_PERMISSION'
                  ? `Copia automática en «${autoBackup.folderName}» pendiente de reactivar (1 clic)`
                  : 'Copia de seguridad y restauración (Mi Cuaderno.json)'
            }
            aria-label="Copia de seguridad y restauración"
            className={`relative ${iconBtnSize} shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 flex items-center justify-center transition-colors`}
          >
            <HardDrive className="w-4 h-4 shrink-0" aria-hidden="true" />
            {(autoBackup.status === 'ACTIVE' || autoBackup.status === 'SAVING') && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
                aria-hidden="true"
              />
            )}
            {autoBackup.status === 'NEEDS_PERMISSION' && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white"
                aria-hidden="true"
              />
            )}
          </button>

          {pwa.canPromptInstall && (
            <button
              type="button"
              onClick={() => void pwa.triggerInstall()}
              aria-disabled={pwa.installing}
              title="Instalar Mi Cuaderno como aplicación en este dispositivo"
              aria-label="Instalar aplicación Mi Cuaderno"
              data-pwa-install-btn="topbar"
              className={`${iconBtnSize} shrink-0 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center transition-colors`}
            >
              <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (window.confirm('¿Restaurar las clases y alumnos de demostración iniciales?')) {
                loadDemoData();
              }
            }}
            title="Restaurar datos de demostración iniciales"
            aria-label="Restaurar datos demo"
            className={`${iconBtnSize} shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-colors`}
          >
            <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>

          {pwaUpdate.updateAvailable && (
            <button
              type="button"
              onClick={() => void pwaUpdate.applyUpdateNow()}
              disabled={pwaUpdate.updating}
              title="Hay una nueva versión disponible en GitHub Pages — pulsa para actualizar ahora"
              className="h-8 px-2.5 shrink-0 rounded-xl border border-indigo-300 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1 shadow-xs animate-pulse"
            >
              <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{pwaUpdate.updating ? 'Actualizando...' : 'Actualizar'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenAuth}
            aria-label={
              !isOnline
                ? 'Sin conexión: cambios guardados en el dispositivo'
                : syncConflicts.length > 0
                  ? `${syncConflicts.length} conflicto(s) de sincronización por revisar`
                  : user && isFirebaseConfigured
                    ? `Cuenta conectada: ${user.displayName ?? user.email ?? 'Firebase'}`
                    : isFirebaseConfigured
                      ? 'Iniciar sesión o sincronizar con Firebase'
                      : 'Modo local (sin Firebase configurado)'
            }
            title={
              !isOnline
                ? 'Sin conexión · Los cambios se guardan en el dispositivo y se sincronizarán al recuperar Wi-Fi'
                : syncConflicts.length > 0
                  ? `${syncConflicts.length} celda(s) editadas en dos dispositivos — pulsa para revisar`
                  : user && isFirebaseConfigured
                    ? `Conectado (${syncStatus === 'syncing' ? 'Guardando...' : hasPendingSync ? 'Pendiente de subir' : user.email ?? 'Firebase'})`
                    : isFirebaseConfigured
                      ? 'Entrar / Sincronizar con Firebase'
                      : 'Modo Local · Estado de sincronización'
            }
            className={`relative ${iconBtnSize} shrink-0 rounded-xl border flex items-center justify-center transition-colors ${
              !isOnline
                ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                : syncConflicts.length > 0
                  ? 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                  : user && isFirebaseConfigured
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            {!isOnline ? (
              <WifiOff className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
            ) : user && isFirebaseConfigured ? (
              <Cloud className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            ) : isFirebaseConfigured ? (
              <UserCheck className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            ) : (
              <CloudOff className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
            )}
            {syncHasAlert && (
              <span
                aria-hidden="true"
                className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                  syncConflicts.length > 0 ? 'bg-rose-500' : 'bg-amber-500'
                }`}
              />
            )}
          </button>
        </div>
      )}
    </header>
  );
};
