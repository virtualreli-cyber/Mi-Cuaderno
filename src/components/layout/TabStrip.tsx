import React, { useState } from 'react';
import { Lock, Pencil, Plus, Send } from 'lucide-react';
import { PASTEL_SWATCHES } from '../../constants/colors';
import { useGradebook } from '../../context/GradebookContext';
import { useDeviceProfile } from '../../hooks/useDeviceProfile';
import { useTouchLongPress } from '../../hooks/useLongPress';
import type { ClassBook, TabEntity } from '../../types/gradebook';

interface TabStripProps {
  onEditTab: (tab: TabEntity) => void;
  onOpenTemplateCopy?: (template: ClassBook) => void;
}

export const TabStrip: React.FC<TabStripProps> = ({ onEditTab, onOpenTemplateCopy }) => {
  const device = useDeviceProfile();
  const longPress = useTouchLongPress();
  const { activeBook, activeTab, isTemplateMode, selectTab, addTab, reorderTabs } = useGradebook();
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  if (!activeBook) return null;

  const sortedTabs = [...activeBook.tabs].sort((a, b) => a.orderIndex - b.orderIndex);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const color = PASTEL_SWATCHES[sortedTabs.length % PASTEL_SWATCHES.length].hex;
    addTab(newTitle.trim() || `Pestaña ${sortedTabs.length + 1}`, color);
    setNewTitle('');
    setCreating(false);
  };

  return (
    <div
      style={{
        paddingLeft: 'max(0.75rem, var(--safe-left))',
        paddingRight: 'max(0.75rem, var(--safe-right))',
      }}
      className="shrink-0 bg-slate-100/80 border-b border-slate-200 pt-2 flex items-end gap-1.5 overflow-x-auto no-scrollbar select-none"
    >
      {sortedTabs.map((tab) => {
        const isActive = activeTab?.id === tab.id;
        const isOver = dragOverTabId === tab.id && dragTabId !== tab.id;
        return (
          <div
            key={tab.id}
            draggable={!device.isTouch}
            onPointerDown={(e) => {
              longPress.start(e, () => onEditTab(tab));
            }}
            onPointerMove={longPress.move}
            onPointerUp={longPress.cancel}
            onPointerCancel={longPress.cancel}
            onDragStart={(e) => {
              setDragTabId(tab.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', tab.id);
            }}
            onDragEnd={() => {
              setDragTabId(null);
              setDragOverTabId(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragTabId && dragTabId !== tab.id) setDragOverTabId(tab.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const srcId = dragTabId || e.dataTransfer.getData('text/plain');
              if (srcId && srcId !== tab.id) {
                reorderTabs(srcId, tab.id);
              }
              setDragTabId(null);
              setDragOverTabId(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onEditTab(tab);
            }}
            style={{
              backgroundColor: isActive ? tab.color : `${tab.color}88`,
            }}
            className={`group flex items-center gap-1.5 rounded-t-xl border border-b-0 ${
              device.isTouch ? 'px-3.5 py-2.5 min-h-[42px]' : 'px-3 py-1.5'
            } transition-all ${device.isTouch ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} shrink-0 ${
              isActive
                ? 'border-slate-300 text-slate-900 font-bold shadow-2xs translate-y-[1px] pb-[7px]'
                : 'border-slate-200/80 text-slate-700 font-medium hover:brightness-98'
            } ${isOver ? 'ring-2 ring-blue-500' : ''}`}
          >
            <button
              type="button"
              onClick={() => {
                if (longPress.wasJustTriggered()) return;
                selectTab(tab.id);
              }}
              className="flex items-center gap-1.5 text-xs whitespace-nowrap"
            >
              {tab.isLocked && <Lock className="w-3 h-3 text-slate-600" aria-hidden="true" />}
              <span>{tab.title}</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditTab(tab);
              }}
              title={`Configurar pestaña ${tab.title}`}
              aria-label={`Configurar pestaña ${tab.title}`}
              className={`${
                device.isTouch ? 'p-1.5 opacity-100' : 'p-0.5 opacity-70 group-hover:opacity-100'
              } rounded-md text-slate-500 hover:text-slate-900 hover:bg-black/10 transition-opacity`}
            >
              <Pencil className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}

      {creating ? (
        <form onSubmit={handleCreate} className="flex items-center gap-1 mb-1">
          <input
            type="text"
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nombre pestaña..."
            className="px-2 py-1 text-xs rounded-lg border border-blue-400 bg-white w-36 focus:outline-none"
          />
          <button
            type="submit"
            className="px-2 py-1 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
          >
            Crear
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewTitle('');
            }}
            className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-600"
          >
            ✕
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          title="Añadir pestaña"
          className="mb-1 px-2.5 py-1 rounded-lg border border-dashed border-slate-300 bg-white/70 hover:bg-white text-slate-600 hover:text-slate-900 text-xs font-medium flex items-center gap-1 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Pestaña</span>
        </button>
      )}

      {isTemplateMode && onOpenTemplateCopy && (
        <div className="ml-auto mb-1 pl-2 shrink-0">
          <button
            type="button"
            onClick={() => onOpenTemplateCopy(activeBook)}
            className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Copiar a clases...</span>
          </button>
        </div>
      )}
    </div>
  );
};
