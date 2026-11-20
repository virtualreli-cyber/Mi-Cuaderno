import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  GripHorizontal,
  Maximize2,
  Minimize2,
  MoreVertical,
  PanelRight,
  PictureInPicture2,
  RotateCcw,
  X,
} from 'lucide-react';

interface ModalDockContextValue {
  dockedWidth: number;
  setDockEntry: (id: string, width: number | null) => void;
}

const ModalDockContext = createContext<ModalDockContextValue>({
  dockedWidth: 0,
  setDockEntry: () => {},
});

export const ModalDockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [entries, setEntries] = useState<Record<string, number>>({});

  const setDockEntry = useCallback((id: string, width: number | null) => {
    setEntries((prev) => {
      if (width === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (prev[id] === width) return prev;
      return { ...prev, [id]: width };
    });
  }, []);

  const dockedWidth = useMemo(() => {
    const vals = Object.values(entries);
    return vals.length > 0 ? Math.max(...vals) : 0;
  }, [entries]);

  const value = useMemo(() => ({ dockedWidth, setDockEntry }), [dockedWidth, setDockEntry]);

  return <ModalDockContext.Provider value={value}>{children}</ModalDockContext.Provider>;
};

export function useModalDockWidth(): number {
  return useContext(ModalDockContext).dockedWidth;
}

interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  headerActions?: React.ReactNode;
  closedBy?: 'any' | 'closerequest';
  children: React.ReactNode;
}

const MIN_FLOAT_W = 320;
const MIN_FLOAT_H = 220;
const MIN_DOCK_W = 300;
const TOPBAR_HEIGHT = 56;

function clampFloatingRect(rect: FloatingRect): FloatingRect {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const maxW = Math.max(MIN_FLOAT_W, vw - 16);
  const maxH = Math.max(MIN_FLOAT_H, vh - 16);
  const width = Math.max(MIN_FLOAT_W, Math.min(maxW, Math.round(rect.width)));
  const height = Math.max(MIN_FLOAT_H, Math.min(maxH, Math.round(rect.height)));
  const x = Math.max(8, Math.min(vw - width - 8, Math.round(rect.x)));
  const y = Math.max(8, Math.min(vh - height - 8, Math.round(rect.y)));
  return { x, y, width, height };
}

function clampDockWidth(w: number): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const maxW = Math.max(MIN_DOCK_W, vw - 220);
  return Math.max(MIN_DOCK_W, Math.min(maxW, Math.round(w)));
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'w-[min(640px,95vw)]',
  headerActions,
  closedBy = 'any',
  children,
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dockId = useId();
  const { setDockEntry } = useContext(ModalDockContext);

  const pressedOutsideRef = useRef(false);
  const skipCloseCountRef = useRef(0);
  const currentModeRef = useRef<'modal' | 'non-modal' | null>(null);

  const [floatingRect, setFloatingRect] = useState<FloatingRect | null>(null);
  const [dockedRight, setDockedRight] = useState(false);
  const [dockWidth, setDockWidth] = useState(450);
  const [isDragging, setIsDragging] = useState(false);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const announce = useCallback((msg: string) => {
    setLiveAnnouncement(msg);
    window.setTimeout(() => {
      setLiveAnnouncement((prev) => (prev === msg ? '' : prev));
    }, 1000);
  }, []);

  // Reset transient menu, mode, & dock on close
  useEffect(() => {
    if (!open) {
      setWindowMenuOpen(false);
      setDockedRight(false);
      setFloatingRect(null);
      setDockEntry(dockId, null);
      skipCloseCountRef.current = 0;
    }
  }, [open, dockId, setDockEntry]);

  // Register/unregister dock width with workspace layout
  useEffect(() => {
    if (open && dockedRight) {
      setDockEntry(dockId, dockWidth);
    } else {
      setDockEntry(dockId, null);
    }
    return () => setDockEntry(dockId, null);
  }, [open, dockedRight, dockWidth, dockId, setDockEntry]);

  // Manage native <dialog> opening in modal vs non-modal mode
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) {
        skipCloseCountRef.current += 1;
        dialog.close();
      }
      currentModeRef.current = null;
      return;
    }

    const desired: 'modal' | 'non-modal' = dockedRight ? 'non-modal' : 'modal';
    if (dialog.open && currentModeRef.current !== desired) {
      skipCloseCountRef.current += 1;
      dialog.close();
    }

    if (!dialog.open) {
      if (desired === 'modal') {
        dialog.showModal();
      } else {
        dialog.show();
      }
      currentModeRef.current = desired;
    }
  }, [open, dockedRight]);

  // Fallback light-dismiss for browsers without `closedBy` in HTMLDialogElement (only in floating modal mode)
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open || dockedRight || closedBy !== 'any') return;
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    const onDown = (e: PointerEvent) => {
      pressedOutsideRef.current = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutsideRef.current && isOutside(e)) {
        dialog.close();
      }
      pressedOutsideRef.current = false;
    };

    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, [open, dockedRight, closedBy]);

  // Re-clamp floating rect or dock width on viewport resize
  useEffect(() => {
    const onResize = () => {
      setFloatingRect((prev) => (prev ? clampFloatingRect(prev) : null));
      setDockWidth((prev) => clampDockWidth(prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close window menu on outside click
  useEffect(() => {
    if (!windowMenuOpen) return;
    const onDown = () => setWindowMenuOpen(false);
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [windowMenuOpen]);

  const ensureFloatingRect = useCallback((): FloatingRect => {
    if (floatingRect) return floatingRect;
    const rect = ref.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return clampFloatingRect({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(600, vw - 32);
    const h = Math.min(520, vh - 48);
    return clampFloatingRect({
      x: (vw - w) / 2,
      y: (vh - h) / 2,
      width: w,
      height: h,
    });
  }, [floatingRect]);

  // Start dragging popup by handle or header
  const startWindowDrag = (e: React.PointerEvent, requireHandle = false) => {
    if (dockedRight || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!requireHandle && target.closest('button, input, select, textarea, a')) {
      return;
    }

    e.preventDefault();
    const startRect = ensureFloatingRect();
    setFloatingRect(startRect);
    const offsetX = e.clientX - startRect.x;
    const offsetY = e.clientY - startRect.y;
    setIsDragging(true);

    const onMove = (ev: PointerEvent) => {
      setFloatingRect(
        clampFloatingRect({
          ...startRect,
          x: ev.clientX - offsetX,
          y: ev.clientY - offsetY,
        })
      );
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Start resizing floating popup (corner or edges)
  const startFloatingResize = (
    e: React.PointerEvent,
    edge: 'right' | 'left' | 'bottom' | 'corner'
  ) => {
    if (dockedRight || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startRect = ensureFloatingRect();
    setFloatingRect(startRect);
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let next = { ...startRect };

      if (edge === 'right' || edge === 'corner') {
        next.width = startRect.width + dx;
      }
      if (edge === 'bottom' || edge === 'corner') {
        next.height = startRect.height + dy;
      }
      if (edge === 'left') {
        const vw = window.innerWidth;
        const proposedW = Math.max(MIN_FLOAT_W, Math.min(vw - 16, startRect.width - dx));
        const deltaW = proposedW - startRect.width;
        next.width = proposedW;
        next.x = startRect.x - deltaW;
      }

      setFloatingRect(clampFloatingRect(next));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Adjust docked panel width by dragging left edge
  const startDockResize = (e: React.PointerEvent) => {
    if (!dockedRight || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const onMove = (ev: PointerEvent) => {
      setDockWidth(clampDockWidth(window.innerWidth - ev.clientX));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const scaleFloatingWindow = (factor: number) => {
    setDockedRight(false);
    const cur = ensureFloatingRect();
    const nextW = cur.width * factor;
    const nextH = cur.height * factor;
    setFloatingRect(
      clampFloatingRect({
        x: cur.x - (nextW - cur.width) / 2,
        y: cur.y - (nextH - cur.height) / 2,
        width: nextW,
        height: nextH,
      })
    );
    announce(factor > 1 ? 'Ventana agrandada' : 'Ventana reducida');
  };

  const resetWindowPosition = () => {
    setDockedRight(false);
    setFloatingRect(null);
    announce('Posición y tamaño restaurados');
  };

  const toggleDockRight = () => {
    setWindowMenuOpen(false);
    setDockedRight((prev) => {
      const next = !prev;
      if (next) {
        const curW = floatingRect?.width ?? ref.current?.getBoundingClientRect().width ?? 450;
        setDockWidth(clampDockWidth(Math.min(540, Math.max(380, curW))));
        announce('Ventana anclada a la derecha');
      } else {
        announce('Ventana flotante');
      }
      return next;
    });
  };

  const handleHandleKeyDown = (e: React.KeyboardEvent) => {
    if (dockedRight) return;
    const step = 16;
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown'
    ) {
      e.preventDefault();
      const cur = ensureFloatingRect();
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      setFloatingRect(clampFloatingRect({ ...cur, x: cur.x + dx, y: cur.y + dy }));
      announce(
        e.key === 'ArrowLeft'
          ? 'Movido a la izquierda'
          : e.key === 'ArrowRight'
            ? 'Movido a la derecha'
            : e.key === 'ArrowUp'
              ? 'Movido arriba'
              : 'Movido abajo'
      );
    }
  };

  if (!open) return null;

  const dialogStyle: React.CSSProperties = dockedRight
    ? {
        position: 'fixed',
        top: TOPBAR_HEIGHT,
        right: 0,
        bottom: 0,
        left: 'auto',
        width: dockWidth,
        height: `calc(100vh - ${TOPBAR_HEIGHT}px)`,
        maxWidth: 'none',
        maxHeight: 'none',
        margin: 0,
        zIndex: 35,
      }
    : floatingRect
      ? {
          position: 'fixed',
          left: floatingRect.x,
          top: floatingRect.y,
          width: floatingRect.width,
          height: floatingRect.height,
          maxWidth: 'none',
          maxHeight: 'none',
          margin: 0,
        }
      : {};

  return (
    <dialog
      ref={ref}
      {...(!dockedRight && closedBy === 'any'
        ? ({ closedby: 'any' } as Record<string, string>)
        : !dockedRight
          ? ({ closedby: 'closerequest' } as Record<string, string>)
          : {})}
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (dockedRight) {
          e.preventDefault();
        }
      }}
      onClose={(e) => {
        const d = e.currentTarget;
        d.returnValue = '';
        if (skipCloseCountRef.current > 0) {
          skipCloseCountRef.current -= 1;
          return;
        }
        // If dialog was already re-opened (e.g. transitioning modal <-> docked), ignore stale close
        if (d.open) return;
        onClose();
      }}
      style={dialogStyle}
      className={
        dockedRight
          ? 'bg-white text-slate-900 border-0 border-l border-slate-300 shadow-2xl p-0 rounded-none overflow-visible'
          : `${floatingRect ? '' : `${maxWidthClass} m-auto max-h-[90vh]`} rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 overflow-visible`
      }
    >
      {/* Accessibility live status region */}
      <div className="sr-only" aria-live="polite">
        {liveAnnouncement}
      </div>

      {/* Left-edge lateral resizer when docked right */}
      {dockedRight && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ajustar anchura del panel anclado"
          onPointerDown={startDockResize}
          title="Arrastra para ajustar la anchura del panel lateral"
          className="absolute top-0 left-0 -translate-x-1/2 w-2.5 h-full cursor-col-resize z-30 group flex items-center justify-center"
        >
          <span className="w-1 h-12 rounded-full bg-slate-300 group-hover:bg-blue-500 transition-colors" />
        </div>
      )}

      {/* Edge & corner resizers when floating */}
      {!dockedRight && (
        <>
          <div
            aria-hidden="true"
            onPointerDown={(e) => startFloatingResize(e, 'right')}
            className="absolute top-2 right-0 w-1.5 h-[calc(100%-20px)] cursor-ew-resize z-20"
          />
          <div
            aria-hidden="true"
            onPointerDown={(e) => startFloatingResize(e, 'left')}
            className="absolute top-2 left-0 w-1.5 h-[calc(100%-20px)] cursor-ew-resize z-20"
          />
          <div
            aria-hidden="true"
            onPointerDown={(e) => startFloatingResize(e, 'bottom')}
            className="absolute bottom-0 left-2 right-5 h-1.5 cursor-ns-resize z-20"
          />
          <div
            role="separator"
            aria-label="Redimensionar ventana"
            title="Arrastra para agrandar o reducir la ventana"
            onPointerDown={(e) => startFloatingResize(e, 'corner')}
            className="absolute bottom-0.5 right-0.5 w-4 h-4 cursor-nwse-resize z-30 flex items-end justify-end p-0.5 text-slate-400 hover:text-blue-600"
          >
            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 fill-current">
              <path d="M11 3v8H3l8-8z" />
            </svg>
          </div>
        </>
      )}

      <div
        className={`flex flex-col ${
          dockedRight || floatingRect ? 'h-full' : 'max-h-[90vh]'
        } ${dockedRight ? 'rounded-none' : 'rounded-2xl'} overflow-hidden bg-white`}
      >
        <header
          onPointerDown={(e) => startWindowDrag(e, false)}
          className={`px-4 py-3 border-b border-slate-200 bg-slate-50/90 flex items-center justify-between gap-2 shrink-0 ${
            dockedRight
              ? ''
              : isDragging
                ? 'modal-drag-handle dragging'
                : 'modal-drag-handle'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {!dockedRight && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  startWindowDrag(e, true);
                }}
                onKeyDown={handleHandleKeyDown}
                title="Arrastra o usa las flechas del teclado para mover la ventana"
                aria-label="Asidero para mover ventana. Usa las flechas del teclado o arrastra."
                className="modal-drag-handle p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 shrink-0"
              >
                <GripHorizontal className="w-4 h-4" />
              </button>
            )}

            <div className="min-w-0 select-text">
              <h2 id={titleId} className="text-sm sm:text-base font-bold text-slate-900 truncate">
                {title}
              </h2>
              {subtitle && <p className="text-xs text-slate-500 truncate mt-0.5">{subtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 relative">
            {headerActions}

            {/* Direct Dock/Undock Right toggle */}
            <button
              type="button"
              onClick={toggleDockRight}
              title={
                dockedRight
                  ? 'Soltar como ventana flotante'
                  : 'Anclar a la derecha para trabajar en la tabla a la vez'
              }
              aria-label={dockedRight ? 'Desanclar de la derecha' : 'Anclar a la derecha'}
              aria-pressed={dockedRight}
              className={`p-1.5 rounded-lg border transition-colors ${
                dockedRight
                  ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              {dockedRight ? (
                <PictureInPicture2 className="w-4 h-4" />
              ) : (
                <PanelRight className="w-4 h-4" />
              )}
            </button>

            {/* Small Window Operations Menu */}
            <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setWindowMenuOpen((v) => !v)}
                title="Opciones de ventana (mover, tamaño, anclar)"
                aria-label="Opciones de ventana"
                aria-expanded={windowMenuOpen}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {windowMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 z-50 text-xs font-medium text-slate-700">
                  <button
                    type="button"
                    onClick={toggleDockRight}
                    className="w-full px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-left"
                  >
                    {dockedRight ? (
                      <>
                        <PictureInPicture2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>Soltar como popup flotante</span>
                      </>
                    ) : (
                      <>
                        <PanelRight className="w-3.5 h-3.5 text-blue-600" />
                        <span>Anclar a la derecha</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWindowMenuOpen(false);
                      scaleFloatingWindow(1.18);
                    }}
                    className="w-full px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-left"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Agrandar ventana</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWindowMenuOpen(false);
                      scaleFloatingWindow(0.85);
                    }}
                    className="w-full px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-left"
                  >
                    <Minimize2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Hacer más pequeña</span>
                  </button>
                  <hr className="my-1 border-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setWindowMenuOpen(false);
                      resetWindowPosition();
                    }}
                    className="w-full px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-left"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Centrar y restaurar</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar diálogo"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="overflow-y-auto flex-1 bg-white">{children}</div>
      </div>
    </dialog>
  );
};
