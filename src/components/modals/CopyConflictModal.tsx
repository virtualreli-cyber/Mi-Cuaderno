import React, { useEffect, useState } from 'react';
import { AlertTriangle, CopyPlus, RefreshCw, ShieldAlert } from 'lucide-react';
import type { CopyConflictMatch, CopyElementKind } from '../../engine/copyConflictEngine';
import { Modal } from '../common/Modal';

export interface PendingCopyConflict {
  kind: CopyElementKind;
  sourceTitle: string;
  targetClassName: string;
  targetTabTitle?: string;
  matches: CopyConflictMatch[];
}

interface CopyConflictModalProps {
  conflict: PendingCopyConflict | null;
  onCancel: () => void;
  onAddBoth: () => void;
  onReplace: (existingId: string) => void;
}

const KIND_LABEL: Record<CopyElementKind, string> = {
  COLUMN: 'columna / tarea',
  FOLDER: 'carpeta',
  TAB: 'pestaña',
};

export const CopyConflictModal: React.FC<CopyConflictModalProps> = ({
  conflict,
  onCancel,
  onAddBoth,
  onReplace,
}) => {
  const [selectedMatchId, setSelectedMatchId] = useState<string>('');
  const [step, setStep] = useState<'CHOICE' | 'DATA_LOSS'>('CHOICE');

  useEffect(() => {
    if (!conflict) {
      setStep('CHOICE');
      setSelectedMatchId('');
      return;
    }
    setStep('CHOICE');
    setSelectedMatchId(conflict.matches[0]?.id ?? '');
  }, [conflict]);

  if (!conflict || conflict.matches.length === 0) return null;

  const selectedMatch =
    conflict.matches.find((m) => m.id === selectedMatchId) ?? conflict.matches[0];

  const handleRequestReplace = () => {
    if (selectedMatch.dataSummary.hasStudentData) {
      setStep('DATA_LOSS');
    } else {
      onReplace(selectedMatch.id);
    }
  };

  const kindLabel = KIND_LABEL[conflict.kind];
  const locationLabel = conflict.targetTabTitle
    ? `${conflict.targetClassName} · ${conflict.targetTabTitle}`
    : conflict.targetClassName;

  if (step === 'DATA_LOSS') {
    const { gradesCount, commentsCount, affectedStudents } = selectedMatch.dataSummary;
    return (
      <Modal
        open
        closedBy="closerequest"
        onClose={onCancel}
        title="¡Atención! El elemento contiene notas de alumnos"
        subtitle={`Destino: ${locationLabel}`}
        maxWidthClass="w-[min(520px,95vw)]"
      >
        <div className="p-5 space-y-4 text-xs">
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1.5 text-rose-950">
              <p className="font-bold text-sm">
                Vas a eliminar «{selectedMatch.title}» y contiene datos de alumnos
              </p>
              <p className="text-rose-900/90 leading-relaxed">
                Si sustituyes esta {kindLabel} existente por <strong>«{conflict.sourceTitle}»</strong>,
                se perderán permanentemente los datos registrados en ella:
              </p>
              <ul className="list-disc pl-4 space-y-0.5 font-semibold text-rose-900">
                {gradesCount > 0 && (
                  <li>
                    {gradesCount} {gradesCount === 1 ? 'calificación' : 'calificaciones'}
                  </li>
                )}
                {commentsCount > 0 && (
                  <li>
                    {commentsCount} {commentsCount === 1 ? 'comentario' : 'comentarios'}
                  </li>
                )}
                <li>
                  {affectedStudents} {affectedStudents === 1 ? 'alumno afectado' : 'alumnos afectados'}
                </li>
              </ul>
              <p className="pt-1 font-medium text-rose-900">
                ¿Deseas continuar y sustituir el elemento, o cancelar?
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => onReplace(selectedMatch.id)}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Continuar y sustituir</span>
            </button>
            <button
              type="button"
              autoFocus
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      closedBy="closerequest"
      onClose={onCancel}
      title="Elemento igual o similar encontrado"
      subtitle={`Destino: ${locationLabel}`}
      maxWidthClass="w-[min(560px,95vw)]"
    >
      <div className="p-5 space-y-4 text-xs">
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-amber-950">
            <p className="font-bold text-sm">
              Ya existe una {kindLabel} igual o similar en «{conflict.targetClassName}»
            </p>
            <p className="text-amber-900/90">
              Estás copiando <strong>«{conflict.sourceTitle}»</strong>. Elige si quieres cancelar,
              añadirla manteniendo las dos, o sustituir la existente.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="font-semibold text-slate-700">
            {conflict.matches.length === 1
              ? 'Elemento existente coincidente:'
              : 'Elementos existentes coincidentes (selecciona cuál sustituirías):'}
          </div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {conflict.matches.map((m) => {
              const isSelected = m.id === selectedMatch.id;
              return (
                <label
                  key={m.id}
                  className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-blue-400 bg-blue-50/50'
                      : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {conflict.matches.length > 1 && (
                      <input
                        type="radio"
                        name="conflict-match"
                        checked={isSelected}
                        onChange={() => setSelectedMatchId(m.id)}
                        className="accent-blue-600"
                      />
                    )}
                    <span className="font-bold text-slate-900 truncate">{m.title}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        m.matchType === 'EXACT'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-sky-100 text-sky-800'
                      }`}
                    >
                      {m.matchType === 'EXACT' ? 'Mismo nombre' : 'Similar'}
                    </span>
                    {m.dataSummary.hasStudentData && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">
                        Con notas ({m.dataSummary.gradesCount})
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onAddBoth}
            className="px-3.5 py-2 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold flex items-center gap-1.5 transition-colors"
          >
            <CopyPlus className="w-3.5 h-3.5" />
            <span>Añadir (quedan los dos)</span>
          </button>
          <button
            type="button"
            onClick={handleRequestReplace}
            className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sustituir</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
