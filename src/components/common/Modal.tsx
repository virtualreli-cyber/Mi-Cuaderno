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
import { createPortal } from 'react-dom';
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
import { useDeviceProfile } from '../../hooks/useDeviceProfile';

const DOCK_PREFS_KEY = 'cuaderno_modal_dock_prefs_v1';

interface ModalDockPrefs {
  dockedRight: boolean;
  dockWidth: number;
}

function loadDockPrefs(): ModalDockPrefs {
  try {
    const raw = localStorage.getItem(DOCK_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        dockedRight: Boolean(parsed?.dockedRight),
        dockWidth:
          typeof parsed?.dockWidth === 'number' && Number.isFinite(parsed.dockWidth)
            ? Math.max(300, Math.min(1100, Math.round(parsed.dockWidth)))
            : 450,
      };
    }
  } catch {
    // ignore storage errors
  }
  return { dockedRight: false, dockWidth: 450 };
}

function saveDockPrefs(prefs: ModalDockPrefs): void {
  try {
    localStorage.setItem(DOCK_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

interface ModalDockContextValue {
  dockedWidth: number;
  hasBlockingTouchModal: boolean;
  globalDockedRight: boolean;
  globalDockWidth: number;
  setGlobalDockedRight: (docked: boolean) => void;
  setGlobalDockWidth: (width: number) => void;
  setDockEntry: (id: string, width: number | null) => void;
  setBlockingTouchModal: (id: string, blocking: boolean) => void;
  claimActiveModal: (id: string, onClose: () => void) => void;
  releaseActiveModal: (id: string) => void;
}

const ModalDockContext = createContext<ModalDockContextValue>({
  dockedWidth: 0,
  hasBlockingTouchModal: false,
  globalDockedRight: false,
  globalDockWidth: 450,
  setGlobalDockedRight: () => {},
  setGlobalDockWidth: () => {},
  setDockEntry: () => {},
  setBlockingTouchModal: () => {},
  claimActiveModal: () => {},
  releaseActiveModal: () => {},
});

export const ModalDockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialPrefs = useRef<ModalDockPrefs | null>(null);
  if (initialPrefs.current === null) {
    initialPrefs.current = loadDockPrefs();
  }
  const [entries, setEntries] = useState<Record<string, number>>({});
  const [blockingTouchEntries, setBlockingTouchEntries] = useState<Record<string, true>>({});
  const [globalDockedRight, setGlobalDockedRightState] = useState<boolean>(
    initialPrefs.current.dockedRight
  );
  const [globalDockWidth, setGlobalDockWidthState] = useState<number>(
    initialPrefs.current.dockWidth
  );
  const activeModalRef = useRef<{ id: string; onClose: () => void } | null>(null);

  const setGlobalDockedRight = useCallback((docked: boolean) => {
    setGlobalDockedRightState(docked);
    saveDockPrefs({ dockedRight: docked, dockWidth: globalDockWidth });
  }, [globalDockWidth]);

  const setGlobalDockWidth = useCallback((width: number) => {
    const rounded = Math.max(300, Math.round(width));
    setGlobalDockWidthState(rounded);
    saveDockPrefs({ dockedRight: globalDockedRight, dockWidth: rounded });
  }, [globalDockedRight]);

  const claimActiveModal = useCallback((id: string, onClose: () => void) => {
    const prev = activeModalRef.current;
    if (prev && prev.id !== id) {
      activeModalRef.current = { id, onClose };
      prev.onClose();
      return;
    }
    activeModalRef.current = { id, onClose };
  }, []);

  const releaseActiveModal = useCallback((id: string) => {
    if (activeModalRef.current?.id === id) {
      activeModalRef.current = null;
    }
  }, []);

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

  const setBlockingTouchModal = useCallback((id: string, blocking: boolean) => {
    setBlockingTouchEntries((prev) => {
      if (!blocking) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (prev[id]) return prev;
      return { ...prev, [id]: true };
    });
  }, []);

  const dockedWidth = useMemo(() => {
    const vals = Object.values(entries);
    return vals.length > 0 ? Math.max(...vals) : 0;
  }, [entries]);

  const hasBlockingTouchModal = Object.keys(blockingTouchEntries).length > 0;

  const value = useMemo(
    () => ({
      dockedWidth,
      hasBlockingTouchModal,
      globalDockedRight,
      globalDockWidth,
      setGlobalDockedRight,
      setGlobalDockWidth,
      setDockEntry,
      setBlockingTouchModal,
      claimActiveModal,
      releaseActiveModal,
    }),
    [
      dockedWidth,
      hasBlockingTouchModal,
      globalDockedRight,
      globalDockWidth,
      setGlobalDockedRight,
      setGlobalDockWidth,
      setDockEntry,
      setBlockingTouchModal,
      claimActiveModal,
      releaseActiveModal,
    ]
  );

  return <ModalDockContext.Provider value={value}>{children}</ModalDockContext.Provider>;
};

export function useModalDockWidth(): number {
  return useContext(ModalDockContext).dockedWidth;
}

export function useHasBlockingTouchModal(): boolean {
  return useContext(ModalDockContext).hasBlockingTouchModal;
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
  /** Mark nested confirmation/sub-dialogs so they float without closing or replacing their parent modal */
  isNested?: boolean;
  /** Non-layout-shifting floating popup notice shown inside the modal when an action modifies state */
  notice?: string | null;
  children: React.ReactNode;
}

const MIN_FLOAT_W = 320;
const MIN_FLOAT_H = 220;
const MIN_DOCK_W = 300;
const TOPBAR_HEIGHT = 56;

function clampFloatingRect(rect: FloatingRect): FloatingRect {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh =
    typeof window !== 'undefined'
      ? Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight)
      : 800;
  const maxW = Math.max(280, vw - 16);
  const maxH = Math.max(MIN_FLOAT_H, vh - 16);
  const width = Math.max(Math.min(MIN_FLOAT_W, maxW), Math.min(maxW, Math.round(rect.width)));
  const height = Math.max(Math.min(MIN_FLOAT_H, maxH), Math.min(maxH, Math.round(rect.height)));
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
  closedBy = 'closerequest',
  isNested = false,
  notice = null,
  children,
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dockId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const {
    globalDockedRight,
    globalDockWidth,
    setGlobalDockedRight,
    setGlobalDockWidth,
    setDockEntry,
    setBlockingTouchModal,
    claimActiveModal,
    releaseActiveModal,
  } = useContext(ModalDockContext);

  const pressedOutsideRef = useRef(false);
  const skipCloseCountRef = useRef(0);
  const currentModeRef = useRef<'modal' | 'non-modal' | null>(null);

  const device = useDeviceProfile();
  const [floatingRect, setFloatingRect] = useState<FloatingRect | null>(null);
  const canDockRight = !isNested && (device.isDesktop || device.isTabletLandscape);
  const dockedRight = canDockRight && globalDockedRight;
  // On touch / iPadOS standalone PWA, avoid native showModal() top-layer which can suppress the virtual keyboard for <input>s
  const useTouchPortalOverlay = device.isTouch && !dockedRight;
  const dockWidth = device.isTabletLandscape
    ? Math.min(clampDockWidth(globalDockWidth), Math.max(300, Math.floor(device.viewportWidth * 0.48)))
    : clampDockWidth(globalDockWidth);
  const isMobileSheet = device.isMobile;
  const isTabletPortraitSheet = device.isTabletPortrait;
  const allowDesktopWindowChrome = device.isDesktop || device.isTabletLandscape;
  const [isDragging, setIsDragging] = useState(false);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const announce = useCallback((msg: string) => {
    setLiveAnnouncement(msg);
    window.setTimeout(() => {
      setLiveAnnouncement((prev) => (prev === msg ? '' : prev));
    }, 1000);
  }, []);

  // Replace any previously open top-level modal so docked/floating modals never stack behind each other
  useLayoutEffect(() => {
    if (isNested) return;
    if (open) {
      claimActiveModal(dockId, () => onCloseRef.current());
    } else {
      releaseActiveModal(dockId);
    }
    return () => {
      if (!isNested) releaseActiveModal(dockId);
    };
  }, [open, isNested, dockId, claimActiveModal, releaseActiveModal]);

  // Reset only transient menu & floating rect on close (keep persisted dock mode & width!)
  useEffect(() => {
    if (!open) {
      setWindowMenuOpen(false);
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

  // Mark underlying app shell inert while a touch portal blocking modal is open
  useLayoutEffect(() => {
    if (open && useTouchPortalOverlay) {
      setBlockingTouchModal(dockId, true);
      return () => setBlockingTouchModal(dockId, false);
    }
    setBlockingTouchModal(dockId, false);
  }, [open, useTouchPortalOverlay, dockId, setBlockingTouchModal]);

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

    const desired: 'modal' | 'non-modal' =
      dockedRight || useTouchPortalOverlay ? 'non-modal' : 'modal';
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
  }, [open, dockedRight, useTouchPortalOverlay]);

  // Support Escape key dismissal in touch portal overlay mode (respecting topmost stacked/nested dialog)
  useEffect(() => {
    if (!open || !useTouchPortalOverlay) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const blockingDialogs = document.querySelectorAll(
        'dialog[open][data-modal-blocking="true"]'
      );
      if (blockingDialogs.length > 0 && blockingDialogs[blockingDialogs.length - 1] !== ref.current) {
        return;
      }
      e.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, useTouchPortalOverlay]);

  // Fallback light-dismiss for desktop browsers without `closedBy` in HTMLDialogElement (only in floating modal mode)
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open || dockedRight || useTouchPortalOverlay || closedBy !== 'any') return;
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

  // Re-clamp floating rect on viewport resize (dockWidth is clamped dynamically above)
  useEffect(() => {
    const onResize = () => {
      setFloatingRect((prev) => (prev ? clampFloatingRect(prev) : null));
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

  // Adjust docked panel width by dragging left edge (persisted globally!)
  const startDockResize = (e: React.PointerEvent) => {
    if (!dockedRight || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const onMove = (ev: PointerEvent) => {
      setGlobalDockWidth(clampDockWidth(window.innerWidth - ev.clientX));
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
    if (!isNested) setGlobalDockedRight(false);
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
    if (!isNested) setGlobalDockedRight(false);
    setFloatingRect(null);
    announce('Posición y tamaño restaurados');
  };

  const toggleDockRight = () => {
    if (isNested) return;
    setWindowMenuOpen(false);
    const next = !globalDockedRight;
    setGlobalDockedRight(next);
    if (next) {
      announce('Ventana anclada a la derecha');
    } else {
      announce('Ventana flotante');
    }
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

  const maxVisibleFloatingH = Math.max(
    260,
    Math.min(Math.round(device.viewportHeight * 0.9), device.visualViewportHeight - 16)
  );
  const maxVisibleFloatingW = Math.max(280, device.viewportWidth - 16);

  const dialogStyle: React.CSSProperties = dockedRight
    ? {
        position: 'fixed',
        top: TOPBAR_HEIGHT,
        right: 0,
        bottom: 0,
        left: 'auto',
        width: Math.min(dockWidth, maxVisibleFloatingW),
        height: `calc(100dvh - ${TOPBAR_HEIGHT}px)`,
        maxWidth: '100dvw',
        maxHeight: `calc(100dvh - ${TOPBAR_HEIGHT}px)`,
        margin: 0,
        zIndex: 45,
      }
    : useTouchPortalOverlay
      ? isMobileSheet
        ? {
            position: 'relative',
            inset: 'auto',
            width: '100dvw',
            maxWidth: '100dvw',
            maxHeight: `${Math.max(260, Math.min(Math.round(device.viewportHeight * 0.92), device.visualViewportHeight - 12))}px`,
            margin: 0,
          }
        : {
            position: 'relative',
            inset: 'auto',
            maxWidth: `${maxVisibleFloatingW}px`,
            maxHeight: isTabletPortraitSheet
              ? `${Math.max(280, Math.min(Math.round(device.viewportHeight * 0.88), device.visualViewportHeight - 16))}px`
              : `${maxVisibleFloatingH}px`,
            margin: 0,
          }
      : isMobileSheet
        ? {
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            top: 'auto',
            width: '100dvw',
            maxWidth: '100dvw',
            maxHeight: `${Math.max(300, Math.min(Math.round(device.viewportHeight * 0.92), device.visualViewportHeight - 12))}px`,
            margin: 0,
          }
        : isTabletPortraitSheet
          ? {
              maxWidth: `${maxVisibleFloatingW}px`,
              maxHeight: `${Math.max(320, Math.min(Math.round(device.viewportHeight * 0.88), device.visualViewportHeight - 16))}px`,
              margin: 'auto',
            }
          : floatingRect
            ? {
                position: 'fixed',
                left: floatingRect.x,
                top: floatingRect.y,
                width: floatingRect.width,
                height: floatingRect.height,
                maxWidth: `${maxVisibleFloatingW}px`,
                maxHeight: `${maxVisibleFloatingH}px`,
                margin: 0,
              }
            : {
                maxWidth: `${maxVisibleFloatingW}px`,
                maxHeight: `${maxVisibleFloatingH}px`,
                margin: 'auto',
              };

  const dialogNode = (
    <dialog
      ref={ref}
      {...(!dockedRight && !useTouchPortalOverlay && closedBy === 'any'
        ? ({ closedby: 'any' } as Record<string, string>)
        : !dockedRight && !useTouchPortalOverlay
          ? ({ closedby: 'closerequest' } as Record<string, string>)
          : {})}
      aria-labelledby={titleId}
      aria-modal={!dockedRight ? true : undefined}
      data-modal-blocking={!dockedRight ? 'true' : undefined}
      data-modal-layout={
        dockedRight
          ? 'docked-right'
          : isMobileSheet
            ? 'mobile-sheet'
            : isTabletPortraitSheet
              ? 'tablet-sheet'
              : 'floating'
      }
      onCancel={(e) => {
        if (dockedRight || useTouchPortalOverlay) {
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
          : isMobileSheet
            ? 'bg-white text-slate-900 border-t border-slate-200 shadow-2xl p-0 rounded-t-2xl rounded-b-none overflow-hidden'
            : isTabletPortraitSheet
              ? `w-[min(92dvw,640px)] ${useTouchPortalOverlay ? '' : 'm-auto'} rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 overflow-hidden`
              : `${floatingRect ? '' : `${maxWidthClass} ${useTouchPortalOverlay ? '' : 'm-auto'}`} rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 overflow-hidden`
      }
    >
      {/* Accessibility live status region */}
      <div className="sr-only" aria-live="polite">
        {liveAnnouncement}
      </div>

      {/* Left-edge lateral resizer when docked right (wider touch grabber on iPad landscape) */}
      {dockedRight && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ajustar anchura del panel anclado"
          onPointerDown={startDockResize}
          title="Arrastra para ajustar la anchura del panel lateral"
          style={{ touchAction: 'none' }}
          className={`absolute top-0 left-0 -translate-x-1/2 ${
            device.isTouch ? 'w-5' : 'w-2.5'
          } h-full cursor-col-resize z-30 group flex items-center justify-center`}
        >
          <span
            className={`${
              device.isTouch ? 'w-1.5 h-16 bg-slate-400/90' : 'w-1 h-12 bg-slate-300'
            } rounded-full group-hover:bg-blue-500 transition-colors`}
          />
        </div>
      )}

      {/* Edge & corner resizers when floating on desktop */}
      {!dockedRight && device.isDesktop && (
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
        style={
          isMobileSheet || dockedRight
            ? { paddingBottom: 'var(--safe-bottom)' }
            : undefined
        }
        className={`flex flex-col ${
          dockedRight || floatingRect
            ? 'h-full min-h-0'
            : isMobileSheet
              ? 'max-h-[92dvh] min-h-0'
              : isTabletPortraitSheet
                ? 'max-h-[86dvh] min-h-0'
                : 'max-h-[90dvh] min-h-0'
        } ${dockedRight ? 'rounded-none' : isMobileSheet ? 'rounded-t-2xl' : 'rounded-2xl'} overflow-hidden bg-white`}
      >
        <header
          onPointerDown={
            device.isDesktop && !dockedRight ? (e) => startWindowDrag(e, false) : undefined
          }
          className={`px-4 py-3 border-b border-slate-200 bg-slate-50/90 flex items-center justify-between gap-2 shrink-0 ${
            !device.isDesktop || dockedRight
              ? ''
              : isDragging
                ? 'modal-drag-handle dragging'
                : 'modal-drag-handle'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {device.isDesktop && !dockedRight && (
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

            {/* Direct Dock/Undock Right toggle (Desktop & iPad Landscape) */}
            {canDockRight && (
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
                className={`${
                  device.isTouch ? 'w-10 h-10 flex items-center justify-center' : 'p-1.5'
                } rounded-lg border transition-colors ${
                  dockedRight
                    ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                    : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-200/70'
                }`}
              >
                {dockedRight ? (
                  <PictureInPicture2 className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <PanelRight className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            )}

            {/* Small Window Operations Menu (Desktop & iPad Landscape) */}
            {allowDesktopWindowChrome && (
              <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setWindowMenuOpen((v) => !v)}
                  title="Opciones de ventana (mover, tamaño, anclar)"
                  aria-label="Opciones de ventana"
                  aria-expanded={windowMenuOpen}
                  className={`${
                    device.isTouch ? 'w-10 h-10 flex items-center justify-center' : 'p-1.5'
                  } rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors`}
                >
                  <MoreVertical className="w-4 h-4" aria-hidden="true" />
                </button>

                {windowMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 z-50 text-xs font-medium text-slate-700">
                    {canDockRight && (
                      <button
                        type="button"
                        onClick={toggleDockRight}
                        className="w-full px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-left"
                      >
                        {dockedRight ? (
                          <>
                            <PictureInPicture2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                            <span>Soltar como popup flotante</span>
                          </>
                        ) : (
                          <>
                            <PanelRight className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                            <span>Anclar a la derecha</span>
                          </>
                        )}
                      </button>
                    )}
                    {device.isDesktop && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setWindowMenuOpen(false);
                            scaleFloatingWindow(1.18);
                          }}
                          className="w-full px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-left"
                        >
                          <Maximize2 className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
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
                          <Minimize2 className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
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
                          <RotateCcw className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                          <span>Centrar y restaurar</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar diálogo"
              className={`${
                device.isTouch ? 'w-10 h-10 flex items-center justify-center' : 'p-1.5'
              } rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors`}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 bg-white">{children}</div>

        {notice && (
          <div
            role="status"
            aria-live="polite"
            data-modal-notice-popup="true"
            className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-50 max-w-[90%] px-3.5 py-2 rounded-xl bg-slate-900/95 text-white text-xs font-semibold shadow-xl border border-slate-700/80 text-center"
          >
            {notice}
          </div>
        )}
      </div>
    </dialog>
  );

  if (useTouchPortalOverlay && typeof document !== 'undefined') {
    return createPortal(
      <div
        data-modal-touch-backdrop="true"
        onPointerDown={(e) => {
          if (closedBy !== 'any') return;
          pressedOutsideRef.current = e.target === e.currentTarget;
        }}
        onPointerUp={(e) => {
          if (closedBy !== 'any') return;
          if (pressedOutsideRef.current && e.target === e.currentTarget) {
            onCloseRef.current();
          }
          pressedOutsideRef.current = false;
        }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height:
            device.visualViewportHeight > 0 ? `${device.visualViewportHeight}px` : '100dvh',
          zIndex: isNested ? 80 : 70,
        }}
        className={`bg-slate-900/40 backdrop-blur-[2px] flex overscroll-contain ${
          isMobileSheet ? 'items-end justify-center p-0' : 'items-center justify-center p-2 sm:p-4'
        }`}
      >
        {dialogNode}
      </div>,
      document.body
    );
  }

  return dialogNode;
};
