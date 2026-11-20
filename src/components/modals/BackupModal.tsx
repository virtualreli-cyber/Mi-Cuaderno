import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileJson,
  FolderArchive,
  HardDrive,
  Upload,
} from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { type GradebookWorkspace } from '../../types/gradebook';
import { Modal } from '../common/Modal';

interface BackupModalProps {
  open: boolean;
  onClose: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({ open, onClose }) => {
  const { workspace, restoreBackup } = useGradebook();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
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

  const handleDownloadBackup = () => {
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
        now.getHours()
      )}${pad(now.getMinutes())}`;
      const filename = `cuaderno_profesor_backup_${stamp}.json`;

      const jsonStr = JSON.stringify(workspace, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      console.error('Error al generar copia de seguridad:', err);
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
        {/* Section 1: Descargar Copia de Seguridad */}
        <div className="p-4 rounded-2xl border border-blue-200 bg-blue-50/50 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-2xs shrink-0">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 leading-tight">
                  Descargar Copia de Seguridad
                </h3>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Genera un archivo seguro (.json) descargable con todos tus datos actuales.
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

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-500">
              Última actualización: {new Date(workspace.updatedAt).toLocaleTimeString('es-ES')}
            </span>

            <button
              type="button"
              onClick={handleDownloadBackup}
              className={`px-4 py-2 rounded-xl font-semibold flex items-center gap-1.5 shadow-sm transition-colors ${
                downloadSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {downloadSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>¡Copia descargada!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Descargar archivo .json</span>
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
