import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileJson,
  FolderArchive,
  FolderCheck,
  FolderCog,
  FolderSync,
  HardDrive,
  Trash2,
  Upload,
} from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { BACKUP_FILENAME } from '../../services/localBackup';
import { type GradebookWorkspace } from '../../types/gradebook';
import { Modal } from '../common/Modal';

interface BackupModalProps {
  open: boolean;
  onClose: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({ open, onClose }) => {
  const {
    workspace,
    restoreBackup,
    autoBackup,
    configureAutoBackupFolder,
    reactivateAutoBackup,
    disableAutoBackupFolder,
    saveManualBackup,
  } = useGradebook();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<'FOLDER' | 'DOWNLOAD' | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [fileToRestore, setFileToRestore] = useState<{
    rawJson: GradebookWorkspace;
    fileName: string;
    classCount: number;
    studentCount: number;
    rubricCount: number;
    dateLabel: string;
  } | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  const totalStudents = useMemo(() => {
    return workspace.classes.reduce((sum, c) => sum + c.students.length, 0);
  }, [workspace.classes]);

  const handleSaveBackupNow = async () => {
    setBusyAction(true);
    try {
      const mode = await saveManualBackup();
      setDownloadSuccess(mode);
      setTimeout(() => setDownloadSuccess(null), 3000);
    } catch (err) {
      console.error('Error al generar copia de seguridad:', err);
    } finally {
      setBusyAction(false);
    }
  };

  const handlePickFolder = async () => {
    setBusyAction(true);
    try {
      const ok = await configureAutoBackupFolder();
      if (ok) {
        setDownloadSuccess('FOLDER');
        setTimeout(() => setDownloadSuccess(null), 3000);
      }
    } finally {
      setBusyAction(false);
    }
  };

  const handleReactivateFolder = async () => {
    setBusyAction(true);
    try {
      const ok = await reactivateAutoBackup();
      if (ok) {
        setDownloadSuccess('FOLDER');
        setTimeout(() => setDownloadSuccess(null), 3000);
      }
    } finally {
      setBusyAction(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRestoreError(null);
    setRestoreSuccess(false);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text) as GradebookWorkspace;

        if (!parsed || !Array.isArray(parsed.classes)) {
          throw new Error('El archivo no contiene un formato válido de cuaderno de profesor.');
        }

        const studentCount = parsed.classes.reduce(
          (sum, c) => sum + (c.students?.length ?? 0),
          0
        );
        const rubricCount = parsed.rubrics?.length ?? 0;
        const dateLabel = parsed.updatedAt
          ? new Date(parsed.updatedAt).toLocaleString('es-ES', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : 'Desconocida';

        setFileToRestore({
          rawJson: parsed,
          fileName: file.name,
          classCount: parsed.classes.length,
          studentCount,
          rubricCount,
          dateLabel,
        });
      } catch (err) {
        setRestoreError(
          err instanceof Error ? err.message : 'Error al leer el archivo JSON seleccionado.'
        );
        setFileToRestore(null);
      }
    };
    reader.onerror = () => {
      setRestoreError('No se pudo leer el archivo.');
      setFileToRestore(null);
    };
    reader.readAsText(file);
  };

  const handleExecuteRestore = () => {
    if (!fileToRestore) return;

    if (
      !window.confirm(
        `¿Deseas restaurar esta copia de seguridad? Se sustituirán los datos actuales del cuaderno por las ${fileToRestore.classCount} clases y ${fileToRestore.studentCount} alumnos de la copia.`
      )
    ) {
      return;
    }

    try {
      restoreBackup(fileToRestore.rawJson);
      setRestoreSuccess(true);
      setTimeout(() => {
        onClose();
        setRestoreSuccess(false);
        setFileToRestore(null);
      }, 1200);
    } catch (err) {
      setRestoreError(
        err instanceof Error ? err.message : 'Error inesperado al restaurar la copia de seguridad.'
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Copia de Seguridad y Restauración"
      subtitle="Guarda o restaura el estado completo de tus clases, notas, rúbricas y ajustes"
      maxWidthClass="w-[min(620px,95vw)]"
    >
      <div className="p-5 space-y-5 text-xs">
        {/* Section 1: Copia automática en carpeta fija (`Mi Cuaderno.json`) + Descarga manual */}
        <div className="p-4 rounded-2xl border border-blue-200 bg-blue-50/50 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-2xs shrink-0">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 leading-tight">
                  Copia de Seguridad (<span className="font-mono text-xs">{BACKUP_FILENAME}</span>)
                </h3>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Se guarda siempre como <strong>{BACKUP_FILENAME}</strong> reemplazando la copia anterior.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="px-2 py-0.5 bg-blue-100 text-blue-900 font-semibold rounded-md text-[10px]">
                {workspace.classes.length} clases
              </span>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-900 font-semibold rounded-md text-[10px]">
                {totalStudents} alumnos
              </span>
            </div>
          </div>

          {/* Automatic fixed-folder status box */}
          {autoBackup.supported ? (
            <div className="p-3 rounded-xl border border-blue-200/80 bg-white/90 space-y-2.5">
              {autoBackup.status === 'ACTIVE' || autoBackup.status === 'SAVING' ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold text-emerald-800 truncate">
                        Guardado automático activo en «{autoBackup.folderName}»
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {autoBackup.status === 'SAVING'
                          ? `Guardando ${BACKUP_FILENAME}...`
                          : autoBackup.lastSavedAt
                            ? `Última copia automática: ${new Date(
                                autoBackup.lastSavedAt
                              ).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`
                            : 'Se actualizará automáticamente al realizar cambios'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => void handlePickFolder()}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1"
                    >
                      <FolderCog className="w-3.5 h-3.5" />
                      <span>Cambiar carpeta</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => void disableAutoBackupFolder()}
                      title="Dejar de guardar automáticamente en esta carpeta"
                      aria-label="Quitar carpeta fija"
                      className="p-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-600 text-slate-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : autoBackup.status === 'NEEDS_PERMISSION' ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderSync className="w-4 h-4 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold text-amber-900 truncate">
                        Carpeta recordada: «{autoBackup.folderName}»
                      </div>
                      <div className="text-[11px] text-amber-800">
                        El navegador pide confirmar permiso en esta sesión (elige «Permitir en cada visita» si aparece para no volver a preguntar).
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => void handleReactivateFolder()}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                    >
                      Reactivar carpeta
                    </button>
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => void handlePickFolder()}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold"
                    >
                      Cambiar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800">
                      Selecciona una carpeta fija para copias automáticas
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Una vez elegida, cada cambio sobrescribirá automáticamente <strong>{BACKUP_FILENAME}</strong> sin preguntar ni abrir diálogos.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handlePickFolder()}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5 shrink-0 shadow-2xs"
                  >
                    <FolderCog className="w-4 h-4" />
                    <span>Elegir carpeta fija</span>
                  </button>
                </div>
              )}

              {autoBackup.error && (
                <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
                  {autoBackup.error}
                </div>
              )}
            </div>
          ) : (
            <div className="p-2.5 rounded-xl border border-slate-200 bg-white/80 text-[11px] text-slate-600">
              Este navegador (como Safari / iPadOS) no permite a las webs sobrescribir archivos automáticamente dentro de una carpeta elegida por seguridad del sistema. Al pulsar descargar se guardará siempre como <strong>{BACKUP_FILENAME}</strong>; en Chrome o Edge de ordenador sí funciona el guardado automático silencioso en carpeta fija.
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-500">
              Último cambio del cuaderno: {new Date(workspace.updatedAt).toLocaleTimeString('es-ES')}
            </span>

            <button
              type="button"
              disabled={busyAction}
              onClick={() => void handleSaveBackupNow()}
              className={`px-4 py-2 rounded-xl font-semibold flex items-center gap-1.5 shadow-sm transition-colors ${
                downloadSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {downloadSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>
                    {downloadSuccess === 'FOLDER'
                      ? `¡Guardado en ${BACKUP_FILENAME}!`
                      : `¡${BACKUP_FILENAME} descargado!`}
                  </span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>
                    {autoBackup.folderName && autoBackup.supported
                      ? `Guardar ${BACKUP_FILENAME} ahora`
                      : `Descargar ${BACKUP_FILENAME}`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Section 2: Restaurar Copia de Seguridad */}
        <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/80 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-slate-700 text-white flex items-center justify-center shadow-2xs shrink-0">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 leading-tight">
                Restaurar Copia de Seguridad
              </h3>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Carga un archivo .json de copia previa para restablecer el cuaderno.
              </p>
            </div>
          </div>

          {/* Hidden File Input + Trigger Box */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />

          {!fileToRestore ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-5 text-center bg-white hover:bg-blue-50/40 transition-colors cursor-pointer group flex flex-col items-center justify-center gap-2"
            >
              <FileJson className="w-8 h-8 text-slate-400 group-hover:text-blue-600 transition-colors" />
              <div>
                <span className="font-semibold text-slate-700 group-hover:text-blue-700 block">
                  Haz clic para seleccionar el archivo de copia (.json)
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5 block">
                  Solo archivos de copia válidos de Cuaderno del Profesor
                </span>
              </div>
            </button>
          ) : (
            <div className="p-3.5 bg-white border border-slate-300 rounded-xl space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900 text-xs truncate block">
                      {fileToRestore.fileName}
                    </span>
                    <span className="text-[11px] text-slate-500 block">
                      Fecha de la copia: {fileToRestore.dateLabel}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setFileToRestore(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  Cambiar archivo
                </button>
              </div>

              {/* Badges of parsed file */}
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="px-2.5 py-1 bg-slate-100 font-semibold text-slate-800 rounded-lg border border-slate-200">
                  {fileToRestore.classCount} clases
                </span>
                <span className="px-2.5 py-1 bg-slate-100 font-semibold text-slate-800 rounded-lg border border-slate-200">
                  {fileToRestore.studentCount} alumnos
                </span>
                <span className="px-2.5 py-1 bg-slate-100 font-semibold text-slate-800 rounded-lg border border-slate-200">
                  {fileToRestore.rubricCount} rúbricas
                </span>
              </div>

              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-[11px] text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Al pulsar restaurar, los datos actuales del cuaderno se reemplazarán completamente por
                  el contenido de esta copia.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleExecuteRestore}
                  disabled={restoreSuccess}
                  className={`px-5 py-2 rounded-xl font-semibold flex items-center gap-1.5 shadow-sm transition-colors ${
                    restoreSuccess
                      ? 'bg-emerald-600 text-white'
                      : 'bg-rose-600 hover:bg-rose-700 text-white'
                  }`}
                >
                  {restoreSuccess ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>¡Cuaderno restaurado con éxito!</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>Confirmar y Restaurar Cuaderno</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {restoreError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{restoreError}</span>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-200">
          <span>
            Las copias de seguridad incluyen clases, evaluaciones, notas, rúbricas y ajustes de diseño.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-semibold text-slate-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
};
