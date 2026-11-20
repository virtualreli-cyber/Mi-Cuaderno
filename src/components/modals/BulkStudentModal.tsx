import React, { useMemo, useState } from 'react';
import {
  Check,
  ClipboardCopy,
  Download,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { exportStudentList, parseStudentList } from '../../engine/gradeMath';
import { Modal } from '../common/Modal';

interface BulkStudentModalProps {
  open: boolean;
  onClose: () => void;
}

export const BulkStudentModal: React.FC<BulkStudentModalProps> = ({ open, onClose }) => {
  const { activeBook, bulkImportStudents } = useGradebook();

  const [activeTab, setActiveTab] = useState<'IMPORT' | 'EXPORT'>('IMPORT');
  const [rawInput, setRawInput] = useState('');
  const [importMode, setImportMode] = useState<'APPEND' | 'REPLACE'>('APPEND');
  const [exportFormat, setExportFormat] = useState<'LAST_FIRST' | 'FIRST_LAST'>('LAST_FIRST');
  const [copied, setCopied] = useState(false);

  const students = activeBook?.students ?? [];

  // Live parsed list for preview
  const parsedStudents = useMemo(() => {
    return parseStudentList(rawInput);
  }, [rawInput]);

  // Exported text
  const exportedText = useMemo(() => {
    return exportStudentList(students, exportFormat);
  }, [students, exportFormat]);

  const handleCopyExport = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(exportedText);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadTxt = () => {
    const filename = `${activeBook?.name || 'alumnos'}_lista.txt`.replace(/\s+/g, '_');
    const blob = new Blob([exportedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExecuteImport = () => {
    if (parsedStudents.length === 0) return;

    if (
      importMode === 'REPLACE' &&
      students.length > 0 &&
      !window.confirm(
        `¿Seguro que deseas REEMPLAZAR los ${students.length} alumnos actuales por los ${parsedStudents.length} nuevos? Las notas de los alumnos que no coincidan se perderán.`
      )
    ) {
      return;
    }

    bulkImportStudents(parsedStudents, importMode);
    setRawInput('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Gestión de Alumnado en Masa"
      subtitle={
        activeBook
          ? `${activeBook.name} · ${students.length} alumnos registrados`
          : 'Importar y exportar listas'
      }
      maxWidthClass="w-[min(680px,95vw)]"
    >
      <div className="flex flex-col text-xs">
        {/* Top Segmented Tab Switcher */}
        <div className="flex items-center border-b border-slate-200 bg-slate-50 px-5 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('IMPORT')}
            className={`px-4 py-2 font-semibold border-b-2 text-xs flex items-center gap-1.5 transition-colors ${
              activeTab === 'IMPORT'
                ? 'border-blue-600 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Importar lista (Pegar)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('EXPORT')}
            className={`px-4 py-2 font-semibold border-b-2 text-xs flex items-center gap-1.5 transition-colors ${
              activeTab === 'EXPORT'
                ? 'border-blue-600 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardCopy className="w-3.5 h-3.5" />
            <span>Exportar lista (Copiar)</span>
          </button>
        </div>

        {/* Tab 1: IMPORT */}
        {activeTab === 'IMPORT' && (
          <div className="p-5 space-y-4">
            <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-blue-900 text-[11px] leading-relaxed">
              <strong>Formato recomendado:</strong> Pega una lista de alumnos (un alumno por línea) con el formato{' '}
              <code className="bg-blue-100 text-blue-950 px-1 py-0.5 rounded font-mono font-bold">
                Apellidos, Nombre
              </code>{' '}
              (por ejemplo: <code>García Pérez, Lucía</code>). También puedes incluir grupo entre paréntesis{' '}
              <code>(1ºA)</code>.
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5 font-semibold text-slate-700">
                <label htmlFor="bulk-student-textarea">Pega aquí la lista de alumnos:</label>
                {rawInput && (
                  <button
                    type="button"
                    onClick={() => setRawInput('')}
                    className="text-slate-400 hover:text-rose-600 flex items-center gap-1 text-[11px]"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Limpiar</span>
                  </button>
                )}
              </div>
              <textarea
                id="bulk-student-textarea"
                rows={6}
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder={`García Pérez, Lucía\nMartínez Soler, Marc\nPérez Gómez, Alejandro (1ºA)\nRuiz Morales, Elena\nSantos Vega, Carlos`}
                className="w-full font-mono text-xs border border-slate-300 rounded-xl p-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 leading-relaxed"
              />
            </div>

            {/* Live Parsing Preview */}
            {parsedStudents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-slate-700">
                  <span className="font-bold flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-emerald-600" />
                    <span>Vista previa ({parsedStudents.length} alumnos detectados):</span>
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Se importarán como apellidos y nombre separados
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl bg-slate-50 divide-y divide-slate-200">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-100 sticky top-0 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                      <tr>
                        <th className="px-3 py-1.5 w-10 text-center">#</th>
                        <th className="px-3 py-1.5">Apellidos</th>
                        <th className="px-3 py-1.5">Nombre</th>
                        <th className="px-3 py-1.5 w-24">Grupo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {parsedStudents.map((st, idx) => (
                        <tr key={idx} className="hover:bg-blue-50/50">
                          <td className="px-3 py-1.5 text-center text-slate-400 tabular-nums font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-1.5 font-semibold text-slate-900">{st.lastName || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-700">{st.firstName || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-500 text-[11px]">
                            {st.group ? (
                              <span className="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded-md font-medium text-[10px]">
                                {st.group}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Mode selection: Append vs Replace */}
            <div className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/70 space-y-2">
              <span className="font-semibold text-slate-800 block">Modo de importación:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label
                  className={`p-2.5 rounded-lg border cursor-pointer flex items-start gap-2 transition-colors ${
                    importMode === 'APPEND'
                      ? 'bg-blue-50/80 border-blue-300 text-blue-950'
                      : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="bulk-import-mode"
                    checked={importMode === 'APPEND'}
                    onChange={() => setImportMode('APPEND')}
                    className="accent-blue-600 mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-xs">Añadir a la lista actual</div>
                    <div className="text-[11px] text-slate-500 leading-tight mt-0.5">
                      Mantiene los {students.length} alumnos actuales y añade los {parsedStudents.length} al final.
                    </div>
                  </div>
                </label>

                <label
                  className={`p-2.5 rounded-lg border cursor-pointer flex items-start gap-2 transition-colors ${
                    importMode === 'REPLACE'
                      ? 'bg-rose-50/80 border-rose-300 text-rose-950'
                      : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="bulk-import-mode"
                    checked={importMode === 'REPLACE'}
                    onChange={() => setImportMode('REPLACE')}
                    className="accent-rose-600 mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-xs text-rose-900">Reemplazar lista completa</div>
                    <div className="text-[11px] text-slate-500 leading-tight mt-0.5">
                      Sustituye a todos los alumnos actuales por la nueva lista.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={parsedStudents.length === 0}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>
                  {parsedStudents.length === 0
                    ? 'Importar alumnos'
                    : `Importar ${parsedStudents.length} alumnos`}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: EXPORT */}
        {activeTab === 'EXPORT' && (
          <div className="p-5 space-y-4">
            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-emerald-950 text-[11px] leading-relaxed">
              Esta lista contiene los <strong>{students.length} alumnos</strong> de la clase en el orden
              actual, listos para copiar con formato compatible con cualquier hoja de cálculo o iDoceo.
            </div>

            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">Formato de exportación:</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setExportFormat('LAST_FIRST')}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    exportFormat === 'LAST_FIRST'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Apellidos, Nombre
                </button>
                <button
                  type="button"
                  onClick={() => setExportFormat('FIRST_LAST')}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    exportFormat === 'FIRST_LAST'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Nombre Apellidos
                </button>
              </div>
            </div>

            <textarea
              readOnly
              rows={9}
              value={exportedText}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="w-full font-mono text-xs border border-slate-300 rounded-xl p-3 bg-slate-50 focus:bg-white text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />

            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={handleDownloadTxt}
                disabled={students.length === 0}
                className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar archivo .txt</span>
              </button>

              <button
                type="button"
                onClick={handleCopyExport}
                disabled={students.length === 0}
                className={`px-5 py-2 rounded-xl font-semibold flex items-center gap-1.5 shadow-sm transition-colors ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>¡Lista copiada al portapapeles!</span>
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="w-4 h-4" />
                    <span>Copiar lista de alumnos</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
