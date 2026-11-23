import React, { useEffect, useMemo, useState } from 'react';
import { Check, Columns, Folder, FolderPlus, Layers } from 'lucide-react';
import { useGradebook } from '../../context/GradebookContext';
import { findCopyConflicts } from '../../engine/copyConflictEngine';
import type { ClassBook } from '../../types/gradebook';
import { Modal } from '../common/Modal';
import { CopyConflictModal, type PendingCopyConflict } from './CopyConflictModal';

interface TemplateApplyModalProps {
  open: boolean;
  onClose: () => void;
  template: ClassBook | null;
}

type CopyMode = 'COPY_COLUMN' | 'COPY_FOLDER' | 'COPY_TAB' | 'NEW_CLASS';

export const TemplateApplyModal: React.FC<TemplateApplyModalProps> = ({
  open,
  onClose,
  template,
}) => {
  const {
    workspace,
    instantiateTemplateAsClass,
    copyColumnToTarget,
    copyFolderToTarget,
    copyTabToTarget,
  } = useGradebook();

  const [mode, setMode] = useState<CopyMode>('COPY_COLUMN');
  const [newClassName, setNewClassName] = useState('');
  const [newClassSubject, setNewClassSubject] = useState('');
  const [targetClassId, setTargetClassId] = useState('');
  const [targetTabId, setTargetTabId] = useState('');
  const [targetFolderId, setTargetFolderId] = useState('');

  const [selectedColId, setSelectedColId] = useState('');
  const [selectedFolderKey, setSelectedFolderKey] = useState(''); // `${tabId}::${folderId}`
  const [selectedSourceTabId, setSelectedSourceTabId] = useState('');

  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingCopyConflict | null>(null);

  const templateCols = useMemo(
    () =>
      template
        ? template.tabs.flatMap((t) =>
            t.columns.map((c) => ({ tabId: t.id, tabTitle: t.title, col: c }))
          )
        : [],
    [template]
  );

  const templateFolders = useMemo(
    () =>
      template
        ? template.tabs.flatMap((t) =>
            t.folders.map((f) => ({
              key: `${t.id}::${f.id}`,
              tabId: t.id,
              tabTitle: t.title,
              folder: f,
              colCount: t.columns.filter((c) => c.folderId === f.id).length,
            }))
          )
        : [],
    [template]
  );

  useEffect(() => {
    if (!open || !template) return;
    setFeedback(null);
    setPendingConflict(null);
    setNewClassName(`Nueva clase (${template.name})`);
    setNewClassSubject(template.subject);
    const firstCls = workspace.classes[0];
    setTargetClassId(firstCls?.id ?? '');
    setTargetTabId(firstCls?.tabs[0]?.id ?? '');
    setTargetFolderId('');
    setSelectedColId(templateCols[0]?.col.id ?? '');
    setSelectedFolderKey(templateFolders[0]?.key ?? '');
    setSelectedSourceTabId(template.tabs[0]?.id ?? '');
    // Only reset when modal opens or switches to a different template
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  if (!template) return null;

  const targetClass = workspace.classes.find((c) => c.id === targetClassId) ?? null;
  const targetTab = targetClass?.tabs.find((t) => t.id === targetTabId) ?? null;

  const executeCopy = (resolution: 'ADD' | 'REPLACE', replaceId?: string) => {
    if (!targetClass) return;

    if (mode === 'COPY_COLUMN') {
      if (!targetTabId || !selectedColId) return;
      copyColumnToTarget(template.id, selectedColId, targetClass.id, targetTabId, {
        targetFolderId: targetFolderId || null,
        mode: resolution,
        replaceColumnId: replaceId,
      });
      setFeedback(
        resolution === 'REPLACE'
          ? `Columna sustituida en «${targetClass.name}».`
          : `Columna copiada a «${targetClass.name}».`
      );
    } else if (mode === 'COPY_FOLDER') {
      const [srcTabId, srcFldId] = selectedFolderKey.split('::');
      if (!srcTabId || !srcFldId || !targetTabId) return;
      copyFolderToTarget(template.id, srcTabId, srcFldId, targetClass.id, targetTabId, {
        mode: resolution,
        replaceFolderId: replaceId,
      });
      setFeedback(
        resolution === 'REPLACE'
          ? `Carpeta sustituida en «${targetClass.name}».`
          : `Carpeta copiada a «${targetClass.name}».`
      );
    } else if (mode === 'COPY_TAB') {
      if (!selectedSourceTabId) return;
      copyTabToTarget(template.id, selectedSourceTabId, targetClass.id, {
        mode: resolution,
        replaceTabId: replaceId,
      });
      setFeedback(
        resolution === 'REPLACE'
          ? `Pestaña sustituida en «${targetClass.name}».`
          : `Pestaña copiada a «${targetClass.name}».`
      );
    }
    setPendingConflict(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (mode === 'NEW_CLASS') {
      instantiateTemplateAsClass(template.id, newClassName, newClassSubject, template.color);
      onClose();
      return;
    }

    if (!targetClass) return;

    if (mode === 'COPY_COLUMN') {
      const src = templateCols.find((x) => x.col.id === selectedColId);
      if (!src || !targetTab) return;
      const matches = findCopyConflicts(targetClass, 'COLUMN', src.col.title, targetTab.id);
      if (matches.length > 0) {
        setPendingConflict({
          kind: 'COLUMN',
          sourceTitle: src.col.title,
          targetClassName: targetClass.name,
          targetTabTitle: targetTab.title,
          matches,
        });
        return;
      }
      executeCopy('ADD');
    } else if (mode === 'COPY_FOLDER') {
      const src = templateFolders.find((x) => x.key === selectedFolderKey);
      if (!src || !targetTab) return;
      const matches = findCopyConflicts(targetClass, 'FOLDER', src.folder.title, targetTab.id);
      if (matches.length > 0) {
        setPendingConflict({
          kind: 'FOLDER',
          sourceTitle: src.folder.title,
          targetClassName: targetClass.name,
          targetTabTitle: targetTab.title,
          matches,
        });
        return;
      }
      executeCopy('ADD');
    } else if (mode === 'COPY_TAB') {
      const srcTab = template.tabs.find((t) => t.id === selectedSourceTabId);
      if (!srcTab) return;
      const matches = findCopyConflicts(targetClass, 'TAB', srcTab.title);
      if (matches.length > 0) {
        setPendingConflict({
          kind: 'TAB',
          sourceTitle: srcTab.title,
          targetClassName: targetClass.name,
          matches,
        });
        return;
      }
      executeCopy('ADD');
    }
  };

  const canSubmit =
    mode === 'NEW_CLASS'
      ? Boolean(newClassName.trim())
      : mode === 'COPY_COLUMN'
        ? Boolean(targetClass && targetTab && selectedColId)
        : mode === 'COPY_FOLDER'
          ? Boolean(targetClass && targetTab && selectedFolderKey)
          : Boolean(targetClass && selectedSourceTabId);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Plantilla de clase: ${template.name}`}
        subtitle="Copia columnas, carpetas o pestañas de este borrador a tus clases, o crea una clase nueva"
        maxWidthClass="w-[min(600px,95vw)]"
        notice={feedback}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(
              [
                { v: 'COPY_COLUMN', label: 'Columna / Tarea', icon: Columns },
                { v: 'COPY_FOLDER', label: 'Carpeta', icon: Folder },
                { v: 'COPY_TAB', label: 'Pestaña', icon: Layers },
                { v: 'NEW_CLASS', label: 'Nueva clase', icon: FolderPlus },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => {
                    setMode(opt.v);
                    setFeedback(null);
                  }}
                  className={`p-2.5 rounded-xl border font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    mode === opt.v
                      ? 'border-blue-500 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>

          {mode === 'NEW_CLASS' ? (
            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nombre de la clase nueva
                </label>
                <input
                  type="text"
                  required
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Asignatura</label>
                <input
                  type="text"
                  value={newClassSubject}
                  onChange={(e) => setNewClassSubject(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Source selector */}
              {mode === 'COPY_COLUMN' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Columna / tarea de la plantilla
                  </label>
                  {templateCols.length === 0 ? (
                    <p className="text-slate-500 italic">Esta plantilla no tiene columnas todavía.</p>
                  ) : (
                    <select
                      value={selectedColId}
                      onChange={(e) => setSelectedColId(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                    >
                      {templateCols.map(({ tabTitle, col }) => (
                        <option key={col.id} value={col.id}>
                          [{tabTitle}] {col.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {mode === 'COPY_FOLDER' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Carpeta de la plantilla (incluye sus columnas)
                  </label>
                  {templateFolders.length === 0 ? (
                    <p className="text-slate-500 italic">
                      Esta plantilla no tiene carpetas. Crea una carpeta dentro de la plantilla primero.
                    </p>
                  ) : (
                    <select
                      value={selectedFolderKey}
                      onChange={(e) => setSelectedFolderKey(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                    >
                      {templateFolders.map((item) => (
                        <option key={item.key} value={item.key}>
                          [{item.tabTitle}] {item.folder.title} ({item.colCount} cols.)
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {mode === 'COPY_TAB' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Pestaña de la plantilla
                  </label>
                  <select
                    value={selectedSourceTabId}
                    onChange={(e) => setSelectedSourceTabId(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                  >
                    {template.tabs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({t.columns.length} cols. · {t.folders.length} carpetas)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Target Class */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Clase destino</label>
                <select
                  value={targetClassId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setTargetClassId(nextId);
                    const cls = workspace.classes.find((c) => c.id === nextId);
                    setTargetTabId(cls?.tabs[0]?.id ?? '');
                    setTargetFolderId('');
                  }}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                >
                  {workspace.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.subject}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Tab (for column & folder copy) */}
              {(mode === 'COPY_COLUMN' || mode === 'COPY_FOLDER') && targetClass && (
                <div className={mode === 'COPY_COLUMN' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Pestaña destino</label>
                    <select
                      value={targetTabId}
                      onChange={(e) => {
                        setTargetTabId(e.target.value);
                        setTargetFolderId('');
                      }}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                    >
                      {targetClass.tabs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  {mode === 'COPY_COLUMN' && targetTab && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Carpeta destino (opcional)
                      </label>
                      <select
                        value={targetFolderId}
                        onChange={(e) => setTargetFolderId(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                      >
                        <option value="">Sin carpeta (suelta)</option>
                        {targetTab.folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2">
                Si en la clase destino ya existe un elemento con el mismo nombre o similar, se mostrará
                un aviso para cancelar, añadir ambos o sustituirlo.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
            >
              Cerrar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {mode === 'NEW_CLASS'
                  ? 'Crear clase'
                  : mode === 'COPY_TAB'
                    ? 'Copiar pestaña'
                    : mode === 'COPY_FOLDER'
                      ? 'Copiar carpeta'
                      : 'Copiar columna'}
              </span>
            </button>
          </div>
        </form>
      </Modal>

      <CopyConflictModal
        conflict={pendingConflict}
        onCancel={() => setPendingConflict(null)}
        onAddBoth={() => executeCopy('ADD')}
        onReplace={(existingId) => executeCopy('REPLACE', existingId)}
      />
    </>
  );
};
