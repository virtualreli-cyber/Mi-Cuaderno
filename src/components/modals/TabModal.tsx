import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Lock, Trash2 } from 'lucide-react';
import { PASTEL_SWATCHES } from '../../constants/colors';
import { useGradebook } from '../../context/GradebookContext';
import { findCopyConflicts } from '../../engine/copyConflictEngine';
import type { TabEntity } from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { CopyConflictModal, type PendingCopyConflict } from './CopyConflictModal';

interface TabModalProps {
  open: boolean;
  onClose: () => void;
  tab: TabEntity | null;
}

export const TabModal: React.FC<TabModalProps> = ({ open, onClose, tab }) => {
  const { workspace, activeBook, updateTab, duplicateTab, deleteTab, reorderTabs, copyTabToTarget } =
    useGradebook();
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('#DBEAFE');
  const [isLocked, setIsLocked] = useState(false);

  const [copyClassId, setCopyClassId] = useState('');
  const [copyDoneMsg, setCopyDoneMsg] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingCopyConflict | null>(null);

  useEffect(() => {
    if (!open || !tab) return;
    setTitle(tab.title);
    setColor(tab.color);
    setIsLocked(Boolean(tab.isLocked));
    setCopyDoneMsg(null);
    setPendingConflict(null);
    setCopyClassId(workspace.classes[0]?.id ?? '');
    // Only initialize form state when opening or switching target tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab?.id]);

  if (!tab || !activeBook) return null;

  const sortedTabs = [...activeBook.tabs].sort((a, b) => a.orderIndex - b.orderIndex);
  const idx = sortedTabs.findIndex((t) => t.id === tab.id);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateTab(tab.id, {
      title: title.trim() || tab.title,
      color,
      isLocked,
    });
    onClose();
  };

  const copyTargetClass = workspace.classes.find((c) => c.id === copyClassId);

  const executeCopyTab = (resolution: 'ADD' | 'REPLACE', replaceTabId?: string) => {
    if (!copyClassId) return;
    copyTabToTarget(activeBook.id, tab.id, copyClassId, {
      mode: resolution,
      replaceTabId,
    });
    setPendingConflict(null);
    setCopyDoneMsg(
      resolution === 'REPLACE'
        ? 'Pestaña sustituida correctamente.'
        : 'Pestaña copiada correctamente.'
    );
  };

  const handleCopyTabClick = () => {
    if (!copyTargetClass) return;
    setCopyDoneMsg(null);
    const matches = findCopyConflicts(copyTargetClass, 'TAB', tab.title);
    if (matches.length > 0) {
      setPendingConflict({
        kind: 'TAB',
        sourceTitle: tab.title,
        targetClassName: copyTargetClass.name,
        matches,
      });
      return;
    }
    executeCopyTab('ADD');
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Configurar pestaña: ${tab.title}`}
        subtitle="Color, posición, bloqueo, duplicado y copia a otras clases"
        maxWidthClass="w-[min(520px,95vw)]"
      >
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Título de la pestaña</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">Color de la pestaña</label>
            <div className="flex flex-wrap items-center gap-2">
              {PASTEL_SWATCHES.map((sw) => (
                <button
                  key={sw.hex}
                  type="button"
                  onClick={() => setColor(sw.hex)}
                  title={sw.name}
                  className={`w-7 h-7 rounded-lg border-2 transition-transform ${
                    color.toLowerCase() === sw.hex.toLowerCase()
                      ? 'border-slate-900 scale-110'
                      : 'border-slate-200'
                  }`}
                  style={{ backgroundColor: sw.hex }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-8 h-7 rounded-lg border border-slate-300 cursor-pointer"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer font-medium text-slate-800">
            <input
              type="checkbox"
              checked={isLocked}
              onChange={(e) => setIsLocked(e.target.checked)}
              className="accent-blue-600"
            />
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            <span>Bloquear edición en esta pestaña (solo lectura)</span>
          </label>

          {/* Posición y Duplicado */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={idx <= 0}
                onClick={() => idx > 0 && reorderTabs(tab.id, sortedTabs[idx - 1].id)}
                className="flex-1 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 flex items-center justify-center gap-1 font-medium"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Mover izq.</span>
              </button>
              <button
                type="button"
                disabled={idx < 0 || idx >= sortedTabs.length - 1}
                onClick={() =>
                  idx < sortedTabs.length - 1 && reorderTabs(tab.id, sortedTabs[idx + 1].id)
                }
                className="flex-1 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 flex items-center justify-center gap-1 font-medium"
              >
                <span>Mover der.</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  duplicateTab(tab.id, true);
                  onClose();
                }}
                className="flex-1 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 flex items-center justify-center gap-1 font-medium"
              >
                <Copy className="w-3.5 h-3.5 text-blue-600" />
                <span>Duplicar</span>
              </button>
            </div>
          </div>

          {/* Copy tab to another class */}
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-600">Copiar pestaña a clase:</span>
            <select
              value={copyClassId}
              onChange={(e) => setCopyClassId(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1 bg-white flex-1 min-w-[140px]"
            >
              {workspace.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCopyTabClick}
              className="px-2.5 py-1 rounded-lg bg-slate-800 text-white font-semibold hover:bg-slate-900"
            >
              Copiar
            </button>
            {copyDoneMsg && (
              <span className="w-full text-emerald-700 font-semibold">{copyDoneMsg}</span>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            {sortedTabs.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Eliminar la pestaña "${tab.title}" y todas sus columnas?`)) {
                    deleteTab(tab.id);
                    onClose();
                  }
                }}
                className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar pestaña</span>
              </button>
            ) : (
              <span className="text-slate-400">Debe quedar al menos 1 pestaña</span>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Guardar</span>
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <CopyConflictModal
        conflict={pendingConflict}
        onCancel={() => setPendingConflict(null)}
        onAddBoth={() => executeCopyTab('ADD')}
        onReplace={(existingId) => executeCopyTab('REPLACE', existingId)}
      />
    </>
  );
};
