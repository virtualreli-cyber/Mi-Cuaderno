import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  HardDrive,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Trash2,
  Undo2,
  WifiOff,
} from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { Modal } from '../common/Modal';

const EMAIL_STORAGE_KEY = 'cuaderno_cloud_email';

function formatAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('invalid-credential') ||
    msg.includes('wrong-password') ||
    msg.includes('user-not-found')
  ) {
    return 'Correo o contraseña incorrectos.';
  }
  if (msg.includes('invalid-email')) {
    return 'El formato del correo electrónico no es válido.';
  }
  if (msg.includes('too-many-requests')) {
    return 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.';
  }
  if (msg.includes('operation-not-allowed')) {
    return 'Este método de inicio de sesión no está habilitado en Firebase Authentication.';
  }
  if (msg.includes('unauthorized-domain')) {
    return 'Este dominio aún no está autorizado en Firebase Authentication (revisa Authorized domains).';
  }
  if (msg.includes('network-request-failed')) {
    return 'Error de red al conectar con Firebase. Revisa tu conexión a internet.';
  }
  if (msg.includes('popup-closed-by-user')) {
    return 'Inicio de sesión cancelado.';
  }
  return msg;
}

export const AuthModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const pwa = usePwaInstall();
  const {
    user,
    syncStatus,
    syncError,
    isOnline,
    hasPendingSync,
    syncConflicts,
    syncNotice,
    isFirebaseConfigured,
    signInWithEmail,
    sendPasswordReset,
    signInWithGoogle,
    signOutGoogle,
    pushLocalToCloud,
    reconcileCloudNow,
    resolveSyncConflict,
    dismissSyncConflicts,
  } = useGradebook();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(EMAIL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setAuthError(null);
      setAuthInfo(null);
    }
  }, [open]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setAuthError(null);
    setAuthInfo(null);
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      try {
        localStorage.setItem(EMAIL_STORAGE_KEY, email.trim());
      } catch {
        // ignore
      }
      setPassword('');
      onClose();
    } catch (err) {
      setAuthError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) {
      setAuthError('Escribe primero tu correo electrónico para enviarte el enlace de recuperación.');
      return;
    }
    setAuthError(null);
    setAuthInfo(null);
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setAuthInfo(`Correo de recuperación enviado a ${email.trim()}.`);
    } catch (err) {
      setAuthError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthInfo(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setAuthError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sincronización Firebase y Cuenta"
      subtitle="Firebase Authentication + Realtime Database"
      maxWidthClass="w-[min(500px,95vw)]"
    >
      <div className="p-5 space-y-4 text-xs">
        {!isFirebaseConfigured ? (
          <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/70 space-y-2 text-slate-800">
            <div className="font-bold text-sm flex items-center gap-2 text-amber-900">
              <CloudOff className="w-4 h-4" />
              <span>Modo Local / Sin conexión activo</span>
            </div>
            <p className="leading-relaxed">
              Todos tus cambios se guardan automáticamente en este navegador (<code>localStorage</code> e <code>IndexedDB</code>).
            </p>
            <p className="leading-relaxed text-slate-600">
              Para activar la sincronización con tu proyecto Firebase, añade las variables <code>VITE_FIREBASE_*</code> en <code>.env.local</code> o en los <em>Secrets</em> de GitHub Actions.
            </p>
          </div>
        ) : user ? (
          <div className="space-y-3">
            <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-sm text-emerald-950 truncate">
                  {user.displayName ?? user.email?.split('@')[0] ?? 'Docente'}
                </div>
                <div className="text-emerald-800 truncate">{user.email}</div>
                <div className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
                  {!isOnline ? (
                    <WifiOff className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                  ) : (
                    <Cloud className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    Estado:{' '}
                    {!isOnline
                      ? 'Sin conexión (guardado localmente; se combinará al reconectar)'
                      : syncStatus === 'synced'
                        ? hasPendingSync
                          ? 'Cambios locales pendientes de subir'
                          : 'Sincronizado en tiempo real (fusión segura 3 vías)'
                        : syncStatus === 'syncing'
                          ? 'Sincronizando y combinando...'
                          : syncStatus === 'error'
                            ? 'Error de sincronización'
                            : 'Local'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => signOutGoogle()}
                className="px-3 py-1.5 rounded-xl bg-white border border-emerald-200 text-emerald-900 font-semibold hover:bg-emerald-100 flex items-center gap-1 shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Salir</span>
              </button>
            </div>

            {syncNotice && (
              <div
                role="status"
                className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 font-medium flex items-start justify-between gap-2"
              >
                <span>{syncNotice}</span>
                <button
                  type="button"
                  onClick={dismissSyncConflicts}
                  className="text-[11px] font-bold text-blue-700 hover:underline shrink-0"
                >
                  Ocultar
                </button>
              </div>
            )}

            {syncConflicts.length > 0 && (
              <div className="p-3.5 rounded-2xl border border-amber-300 bg-amber-50/80 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-amber-950 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                    <span>
                      {syncConflicts.length} celda(s) editadas a la vez en dos dispositivos
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={dismissSyncConflicts}
                    className="text-[11px] font-semibold text-amber-800 hover:underline"
                  >
                    Mantener actual
                  </button>
                </div>
                <p className="text-[11px] text-amber-900/80">
                  El resto de notas se han combinado automáticamente sin perder ningún dato. Elige qué valor prefieres conservar en estas coincidencias exactas:
                </p>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-0.5">
                  {syncConflicts.map((c) => {
                    const fmt = (cell: typeof c.localCell) => {
                      if (!cell) return 'Vacía';
                      const g = cell.grade !== null && cell.grade !== undefined ? String(cell.grade) : '—';
                      return cell.comment ? `${g} · "${cell.comment}"` : g;
                    };
                    return (
                      <div
                        key={c.id}
                        className="p-2.5 rounded-xl bg-white border border-amber-200 space-y-1.5"
                      >
                        <div className="font-bold text-slate-900">
                          {c.bookName} · {c.studentName} · <span className="text-blue-700">{c.columnTitle}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => resolveSyncConflict(c.id, 'LOCAL')}
                            className={`px-2.5 py-2 rounded-lg border text-left transition-colors ${
                              c.chosen === 'LOCAL'
                                ? 'bg-blue-50 border-blue-400 text-blue-950 font-semibold'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-blue-50'
                            }`}
                          >
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">
                              Este dispositivo
                            </div>
                            <div className="truncate">{fmt(c.localCell)}</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => resolveSyncConflict(c.id, 'REMOTE')}
                            className={`px-2.5 py-2 rounded-lg border text-left transition-colors ${
                              c.chosen === 'REMOTE'
                                ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-semibold'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-emerald-50'
                            }`}
                          >
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">
                              Otro dispositivo (nube)
                            </div>
                            <div className="truncate">{fmt(c.remoteCell)}</div>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {syncError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-medium">
                {syncError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy || !isOnline}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await reconcileCloudNow();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Combinar y sincronizar</span>
              </button>
              <button
                type="button"
                disabled={busy || !isOnline}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await pushLocalToCloud();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full py-2.5 px-3 rounded-xl border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sobrescribir nube</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <form
              onSubmit={handleEmailSignIn}
              className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3"
            >
              <p className="text-slate-600 leading-relaxed">
                Inicia sesión con tu cuenta de Firebase (la misma de tu Planner) para guardar y sincronizar tu cuaderno en la nube.
              </p>

              <div>
                <label
                  htmlFor="firebase-login-email"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="firebase-login-email"
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu-correo@ejemplo.com"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="firebase-login-password"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="firebase-login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  />
                </div>
              </div>

              {authError && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-medium">
                  {authError}
                </div>
              )}

              {authInfo && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium">
                  {authInfo}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>{busy ? 'Conectando...' : 'Entrar con correo y contraseña'}</span>
              </button>

              <div className="text-right">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handlePasswordReset}
                  className="text-[11px] font-medium text-blue-600 hover:underline disabled:opacity-50"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            </form>

            <div className="flex items-center gap-2 text-slate-400">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px]">o si activas Google Auth</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleGoogleSignIn}
              className="w-full py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
              <span>Continuar con Google</span>
            </button>
          </div>
        )}

        {/* PWA App Installation Card (Apple iPadOS/iOS & Android) */}
        <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/80 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold text-slate-900">
              <Smartphone className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
              <span>App para iPad, iPhone y Android (PWA)</span>
            </div>
            {pwa.isStandalone && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                Instalada
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Funciona a pantalla completa y <strong>100 % sin conexión</strong> en el aula. Con fusión automática por celda en 3 vías al recuperar Wi-Fi.
          </p>
          {pwa.canPromptInstall && (
            <button
              type="button"
              onClick={() => void pwa.triggerInstall()}
              aria-disabled={pwa.installing}
              className="w-full py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Instalar Mi Cuaderno como App</span>
            </button>
          )}
          {pwa.isIosNonStandalone && (
            <div className="text-[11px] text-blue-900 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 leading-relaxed">
              En <strong>iPad o iPhone</strong>: abre esta web en Safari, pulsa <strong>Compartir</strong> y elige <strong>«Añadir a pantalla de inicio»</strong>.
            </div>
          )}
          {pwa.installStatusMessage && (
            <div role="status" className="text-[11px] font-semibold text-emerald-700">
              {pwa.installStatusMessage}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export const ViewSettingsModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onOpenBackup?: () => void;
}> = ({ open, onClose, onOpenBackup }) => {
  const {
    workspace,
    activeBook,
    activeTab,
    updateBook,
    updateSettings,
    applyUniformColumnWidth,
    applyUniformFolderWidth,
    canUndoAspect,
    undoAspect,
    beginAspectChange,
    loadDemoData,
    resetAll,
  } = useGradebook();
  const s = workspace.settings;

  const [uniformColWidth, setUniformColWidth] = useState(s.defaultColumnWidth ?? 108);
  const [uniformFolderWidth, setUniformFolderWidth] = useState(s.defaultFolderWidth ?? 68);
  const [appliedHint, setAppliedHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setAppliedHint(null);
      return;
    }
    setUniformColWidth(s.defaultColumnWidth ?? 108);
    setUniformFolderWidth(s.defaultFolderWidth ?? 68);
  }, [open, s.defaultColumnWidth, s.defaultFolderWidth]);

  const flashHint = (msg: string) => {
    setAppliedHint(msg);
    window.setTimeout(() => setAppliedHint((prev) => (prev === msg ? null : prev)), 2200);
  };

  const gradeFs = s.gradeFontSize ?? 12.5;
  const textFs = s.textFontSize ?? 13.5;
  const iconSz = s.iconSize ?? 15;
  const groupSpacerH = s.groupSpacerHeight ?? 24;
  const summaryRowH = s.summaryRowHeight ?? 32;
  const groupSpacerRows = activeBook?.groupSpacerRows ?? 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Aspecto y Vista del Cuaderno"
      subtitle="Tamaños de filas, columnas, separadores de grupo, tipografía e iconos"
      maxWidthClass="w-[min(620px,95vw)]"
      notice={appliedHint}
    >
      <div className="p-5 space-y-4 text-xs">
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-2xl border border-indigo-200/80 bg-indigo-50/70">
          <div className="text-[11px] text-indigo-950">
            <span className="font-bold">Historial de aspecto independiente</span>
            <span className="block text-[10px] text-indigo-800/80">
              Cmd+Z solo deshace notas y datos. Usa este botón para revertir cambios de aspecto.
            </span>
          </div>
          <button
            type="button"
            disabled={!canUndoAspect}
            onClick={() => {
              undoAspect();
              flashHint('Último cambio de aspecto deshecho.');
            }}
            data-aspect-undo-btn="modal"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Deshacer aspecto</span>
          </button>
        </div>

        {onOpenBackup && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenBackup();
            }}
            className="w-full p-3 rounded-2xl border border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 text-blue-900 font-semibold flex items-center justify-between transition-colors shadow-2xs"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                <HardDrive className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="font-bold text-xs text-blue-950 leading-tight">
                  Copia de Seguridad y Restauración
                </div>
                <div className="text-[11px] text-blue-800/80 font-normal">
                  Descargar o restaurar archivo .json completo
                </div>
              </div>
            </div>
            <span className="text-xs font-semibold text-blue-700">&rarr;</span>
          </button>
        )}

        {/* Section 1: Row & Column Sizes */}
        <div className="space-y-3 p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-900 text-[12px]">
              Tamaños de filas y columnas
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  applyUniformColumnWidth(80, 'ALL');
                  setUniformColWidth(80);
                  flashHint('Todas las columnas de toda la web ajustadas a 80 px.');
                }}
                className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] shadow-2xs transition-colors"
              >
                Columnas web a 80 px
              </button>
              <button
                type="button"
                onClick={() => {
                  updateSettings({ rowHeight: 36 });
                  flashHint('Todas las filas de toda la web ajustadas a 36 px.');
                }}
                className="px-2.5 py-1 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 text-blue-700 font-semibold text-[11px] shadow-2xs transition-colors"
              >
                Filas web a 36 px
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between font-semibold text-slate-700 mb-1">
                <span>Altura de filas (alumnos)</span>
                <span className="tabular-nums">{s.rowHeight} px</span>
              </div>
              <input
                type="range"
                min={36}
                max={88}
                step={2}
                value={s.rowHeight}
                onPointerDown={beginAspectChange}
                onChange={(e) => updateSettings({ rowHeight: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between font-semibold text-slate-700 mb-1">
                <span>Altura de cabecera</span>
                <span className="tabular-nums">{s.headerHeight} px</span>
              </div>
              <input
                type="range"
                min={56}
                max={150}
                step={2}
                value={s.headerHeight}
                onPointerDown={beginAspectChange}
                onChange={(e) => updateSettings({ headerHeight: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between font-semibold text-slate-700 mb-1">
              <span>Anchura de columna de alumnos</span>
              <span className="tabular-nums">{s.studentColWidth} px</span>
            </div>
            <input
              type="range"
              min={150}
              max={360}
              step={4}
              value={s.studentColWidth}
              onPointerDown={beginAspectChange}
              onChange={(e) => updateSettings({ studentColWidth: Number(e.target.value) })}
              className="w-full accent-blue-600"
            />
          </div>

          {/* Uniform Column Width */}
          {activeBook && activeTab && (
            <div className="pt-2.5 border-t border-slate-200/80 space-y-2.5">
              <div>
                <div className="flex justify-between font-semibold text-slate-700 mb-1">
                  <span>Anchura igual para todas las columnas</span>
                  <span className="tabular-nums">{uniformColWidth} px</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="range"
                    min={36}
                    max={240}
                    step={2}
                    value={uniformColWidth}
                    onChange={(e) => setUniformColWidth(Number(e.target.value))}
                    className="flex-1 min-w-[140px] accent-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      applyUniformColumnWidth(uniformColWidth, 'TAB');
                      flashHint(`Todas las columnas de "${activeTab.title}" ajustadas a ${uniformColWidth} px`);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                  >
                    Esta pestaña
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyUniformColumnWidth(uniformColWidth, 'BOOK');
                      flashHint(`Todas las columnas de "${activeBook.name}" ajustadas a ${uniformColWidth} px`);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 text-blue-700 font-semibold"
                  >
                    Toda la clase
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between font-semibold text-slate-700 mb-1">
                  <span>Anchura igual para todas las carpetas</span>
                  <span className="tabular-nums">{uniformFolderWidth} px</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="range"
                    min={40}
                    max={200}
                    step={2}
                    value={uniformFolderWidth}
                    onChange={(e) => setUniformFolderWidth(Number(e.target.value))}
                    className="flex-1 min-w-[140px] accent-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      applyUniformFolderWidth(uniformFolderWidth, 'TAB');
                      flashHint(`Carpetas de "${activeTab.title}" ajustadas a ${uniformFolderWidth} px`);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold"
                  >
                    Esta pestaña
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyUniformFolderWidth(uniformFolderWidth, 'BOOK');
                      flashHint(`Carpetas de "${activeBook.name}" ajustadas a ${uniformFolderWidth} px`);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold"
                  >
                    Toda la clase
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 2: Group Footer Rows & Spacers */}
        <div className="space-y-3 p-3.5 rounded-2xl border border-indigo-200/80 bg-indigo-50/40">
          <div className="font-bold text-indigo-950 text-[12px]">
            Filas debajo de los grupos y filas de estadísticas
          </div>

          {activeBook && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-700">
                Filas vacías separadoras entre grupos:
              </span>
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => updateBook(activeBook.id, { groupSpacerRows: n })}
                    className={`w-7 h-7 rounded-lg font-bold border transition-colors ${
                      groupSpacerRows === n
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between font-semibold text-slate-700 mb-1">
                <span>Altura filas vacías (debajo de grupos)</span>
                <span className="tabular-nums">{groupSpacerH} px</span>
              </div>
              <input
                type="range"
                min={10}
                max={64}
                step={2}
                value={groupSpacerH}
                onPointerDown={beginAspectChange}
                onChange={(e) => updateSettings({ groupSpacerHeight: Number(e.target.value) })}
                className="w-full accent-indigo-600"
              />
            </div>

            <div>
              <div className="flex justify-between font-semibold text-slate-700 mb-1">
                <span>Altura filas de medias y resumen (toda la app)</span>
                <span className="tabular-nums">{summaryRowH} px</span>
              </div>
              <input
                type="range"
                min={20}
                max={64}
                step={2}
                value={summaryRowH}
                onPointerDown={beginAspectChange}
                onChange={(e) => updateSettings({ summaryRowHeight: Number(e.target.value) })}
                className="w-full accent-indigo-600"
              />
              <div className="text-[10.5px] text-slate-500 mt-0.5">
                Se aplica siempre a todas las clases y plantillas en este dispositivo.
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Typography & Icons */}
        <div className="space-y-3 p-3.5 rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-900 text-[12px]">
              Tamaño de textos, notas e iconos
            </span>
            <button
              type="button"
              onClick={() => {
                updateSettings({
                  gradeFontSize: 12.5,
                  textFontSize: 13.5,
                  iconSize: 15,
                  groupSpacerHeight: 24,
                  summaryRowHeight: 32,
                  rowHeight: 48,
                  headerHeight: 84,
                });
                flashHint('Aspecto restablecido a los valores recomendados.');
              }}
              className="text-[11px] font-semibold text-blue-600 hover:underline"
            >
              Restablecer tamaños
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="flex justify-between font-semibold text-slate-700 mb-1">
                <span>Notas</span>
                <span className="tabular-nums">{gradeFs} px</span>
              </div>
              <input
                type="range"
                min={9}
                max={22}
                step={0.5}
                value={gradeFs}
                onPointerDown={beginAspectChange}
                onChange={(e) => updateSettings({ gradeFontSize: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between font-semibold text-slate-700 mb-1">
                <span>Textos</span>
                <span className="tabular-nums">{textFs} px</span>
              </div>
              <input
                type="range"
                min={10}
                max={20}
                step={0.5}
                value={textFs}
                onPointerDown={beginAspectChange}
                onChange={(e) => updateSettings({ textFontSize: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between font-semibold text-slate-700 mb-1">
                <span>Iconos</span>
                <span className="tabular-nums">{iconSz} px</span>
              </div>
              <input
                type="range"
                min={11}
                max={24}
                step={1}
                value={iconSz}
                onPointerDown={beginAspectChange}
                onChange={(e) => updateSettings({ iconSize: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Formato de nombres</label>
            <select
              value={s.nameFormat}
              onChange={(e) =>
                updateSettings({ nameFormat: e.target.value as 'LAST_FIRST' | 'FIRST_LAST' })
              }
              className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
            >
              <option value="LAST_FIRST">Apellidos, Nombre</option>
              <option value="FIRST_LAST">Nombre Apellidos</option>
            </select>
          </div>

          <label className="flex items-center gap-2 pt-5 cursor-pointer font-medium text-slate-700">
            <input
              type="checkbox"
              checked={s.showStatsRow}
              onChange={(e) => updateSettings({ showStatsRow: e.target.checked })}
              className="accent-blue-600"
            />
            <span>Mostrar filas de resumen al pie</span>
          </label>
        </div>

        <div className="p-3.5 rounded-2xl border border-indigo-200 bg-indigo-50/50 flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5 max-w-xs">
            <div className="font-bold text-indigo-950">Fila de criterios LOMLOE</div>
            <div className="text-[11px] text-indigo-800/90 leading-snug">
              Muestra bajo las cabeceras de cada tarea los criterios de evaluación, competencias específicas y medallas de competencias clave.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={s.showLomloeRow ?? true}
            onClick={() => updateSettings({ showLomloeRow: !(s.showLomloeRow ?? true) })}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors shrink-0 ${
              (s.showLomloeRow ?? true)
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'bg-white border-indigo-300 text-indigo-900 hover:bg-indigo-50'
            }`}
          >
            {(s.showLomloeRow ?? true) ? 'Visible en cabecera' : 'Oculta en cabecera'}
          </button>
        </div>

        <div className="p-3.5 rounded-2xl border border-purple-200 bg-purple-50/50 flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5 max-w-xs">
            <div className="font-bold text-purple-950">Notas de rúbricas (por defecto 0–10)</div>
            <div className="text-[11px] text-purple-800/90 leading-snug">
              Las rúbricas funcionan en %, pero se muestran convertidas de 0 a 10. Al copiar celdas siempre se copia la nota de 0 a 10.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(s.showRubricsAsPercent)}
            onClick={() => updateSettings({ showRubricsAsPercent: !s.showRubricsAsPercent })}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors shrink-0 ${
              s.showRubricsAsPercent
                ? 'bg-purple-600 border-purple-600 text-white'
                : 'bg-white border-purple-300 text-purple-900 hover:bg-purple-50'
            }`}
          >
            {s.showRubricsAsPercent ? 'No convertir: ON (%)' : 'No convertir (ver en %)'}
          </button>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 bg-white space-y-1.5 text-slate-600">
          <div className="font-bold text-slate-800">Atajos en cuadrícula</div>
          <ul className="space-y-1 list-disc list-inside">
            <li><strong>1 clic</strong>: seleccionar celda o columna · <strong>Doble clic</strong>: abrir modal / plegar carpeta (cabecera superior)</li>
            <li><strong>Escribir directamente</strong>: edita nota y comentario sin modal (ej. <code>8.5 bien</code>)</li>
            <li><strong>Enter</strong>: guarda y se queda en la misma celda · <strong>Shift + Enter</strong>: baja · <strong>Shift + Cmd + Enter</strong>: derecha</li>
            <li><strong>Ctrl/Cmd + C / V</strong>: copiar columna seleccionada (siempre en orden alfabético por apellidos) y pegar</li>
            <li><strong>Flechas</strong>: moverse por celdas · <strong>Ctrl/Cmd + Z</strong>: deshacer</li>
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={() => {
              if (window.confirm('¿Cargar clases de ejemplo iniciales?')) {
                loadDemoData();
                onClose();
              }
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 font-semibold flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
            <span>Restaurar datos demo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (window.confirm('¿Vaciar el cuaderno y empezar una clase en blanco?')) {
                resetAll();
                onClose();
              }
            }}
            className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Vaciar cuaderno</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
