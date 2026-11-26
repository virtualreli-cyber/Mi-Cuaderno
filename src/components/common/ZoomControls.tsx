import React, { useEffect, useRef } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';

export function clampZoom(value: number, min = 0.5, max = 1.8): number {
  return Math.round(Math.max(min, Math.min(max, value)) * 100) / 100;
}

export function clampFloatZoom(value: number, min = 0.5, max = 1.8): number {
  return Math.max(min, Math.min(max, value));
}

export interface PinchGestureMeta {
  phase: 'start' | 'move' | 'end';
  source: 'wheel' | 'gesture' | 'touch';
}

function getTouchDistance(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}

/**
 * Attaches non-passive pinch-to-zoom to a scrollable container without triggering browser full-page zoom:
 * - Desktop trackpad / Ctrl+wheel (`wheel` with `ctrlKey`)
 * - Safari macOS/iPadOS `gesturestart` / `gesturechange` / `gestureend`
 * - Multi-touch 2-finger pinch (`touchstart` / `touchmove` / `touchend` on iPadOS & Android tablets/phones)
 * Single-finger panning stays 100% native and uninterrupted.
 *
 * When `onLiveZoom` is provided, emits continuous unrounded zoom values at frame rate during the
 * gesture without committing to React state/undo until the gesture settles (`phase: 'end'`).
 */
export function usePinchZoom(
  containerRef: React.RefObject<HTMLElement | null>,
  zoom: number,
  onChangeZoom: (nextZoom: number) => void,
  options: {
    min?: number;
    max?: number;
    enabled?: boolean;
    onLiveZoom?: (liveZoom: number, meta: PinchGestureMeta) => void;
    wheelSettleMs?: number;
  } = {}
) {
  const { min = 0.5, max = 1.8, enabled = true, onLiveZoom, wheelSettleMs = 130 } = options;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onChangeRef = useRef(onChangeZoom);
  onChangeRef.current = onChangeZoom;
  const onLiveZoomRef = useRef(onLiveZoom);
  onLiveZoomRef.current = onLiveZoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    el.setAttribute('data-pinch-zoom-surface', 'true');

    let wheelActive = false;
    let wheelSettleTimer: number | null = null;
    let liveWheelZoom = zoomRef.current;

    const clearWheelSettle = () => {
      if (wheelSettleTimer !== null) {
        window.clearTimeout(wheelSettleTimer);
        wheelSettleTimer = null;
      }
    };

    const finishWheelGesture = () => {
      clearWheelSettle();
      if (!wheelActive) return;
      wheelActive = false;
      const committed = clampZoom(liveWheelZoom, min, max);
      onLiveZoomRef.current?.(committed, { phase: 'end', source: 'wheel' });
      if (Math.abs(committed - zoomRef.current) >= 0.005) {
        onChangeRef.current(committed);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();

      // Trackpad pinch deltaY is small; mouse ctrl+wheel is larger (~100)
      const stepFactor = Math.abs(e.deltaY) > 40 ? 0.0022 : 0.0065;
      if (!wheelActive) {
        wheelActive = true;
        liveWheelZoom = zoomRef.current;
        onLiveZoomRef.current?.(liveWheelZoom, { phase: 'start', source: 'wheel' });
      }
      liveWheelZoom = clampFloatZoom(liveWheelZoom * Math.exp(-e.deltaY * stepFactor), min, max);

      if (onLiveZoomRef.current) {
        onLiveZoomRef.current(liveWheelZoom, { phase: 'move', source: 'wheel' });
        clearWheelSettle();
        wheelSettleTimer = window.setTimeout(finishWheelGesture, wheelSettleMs);
      } else {
        const next = clampZoom(liveWheelZoom, min, max);
        if (Math.abs(next - zoomRef.current) >= 0.005) {
          onChangeRef.current(next);
        }
        clearWheelSettle();
        wheelSettleTimer = window.setTimeout(() => {
          wheelActive = false;
          wheelSettleTimer = null;
        }, wheelSettleMs);
      }
    };

    let gestureBaseZoom = zoomRef.current;
    let liveGestureZoom = zoomRef.current;
    let gestureActive = false;
    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      clearWheelSettle();
      wheelActive = false;
      gestureActive = true;
      gestureBaseZoom = zoomRef.current;
      liveGestureZoom = gestureBaseZoom;
      onLiveZoomRef.current?.(liveGestureZoom, { phase: 'start', source: 'gesture' });
    };
    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const scale = (e as unknown as { scale?: number }).scale;
      if (typeof scale === 'number' && scale > 0) {
        liveGestureZoom = clampFloatZoom(gestureBaseZoom * scale, min, max);
        if (onLiveZoomRef.current) {
          onLiveZoomRef.current(liveGestureZoom, { phase: 'move', source: 'gesture' });
        } else {
          onChangeRef.current(clampZoom(liveGestureZoom, min, max));
        }
      }
    };

    const handleGestureEnd = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (!gestureActive) return;
      gestureActive = false;
      if (onLiveZoomRef.current) {
        const committed = clampZoom(liveGestureZoom, min, max);
        onLiveZoomRef.current(committed, { phase: 'end', source: 'gesture' });
        if (Math.abs(committed - zoomRef.current) >= 0.005) {
          onChangeRef.current(committed);
        }
      }
    };

    // 2-finger touch pinch for Android tablets/phones & iPadOS Chrome/Safari
    let pinchStartDist: number | null = null;
    let pinchStartZoom = zoomRef.current;
    let liveTouchZoom = zoomRef.current;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        clearWheelSettle();
        wheelActive = false;
        pinchStartDist = getTouchDistance(e.touches[0], e.touches[1]);
        pinchStartZoom = zoomRef.current;
        liveTouchZoom = pinchStartZoom;
        onLiveZoomRef.current?.(liveTouchZoom, { phase: 'start', source: 'touch' });
      } else {
        pinchStartDist = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchStartDist === null || pinchStartDist < 10) return;
      e.preventDefault();
      e.stopPropagation();
      const dist = getTouchDistance(e.touches[0], e.touches[1]);
      const ratio = dist / pinchStartDist;
      liveTouchZoom = clampFloatZoom(pinchStartZoom * ratio, min, max);
      if (onLiveZoomRef.current) {
        onLiveZoomRef.current(liveTouchZoom, { phase: 'move', source: 'touch' });
      } else {
        const next = clampZoom(liveTouchZoom, min, max);
        if (Math.abs(next - zoomRef.current) >= 0.01) {
          onChangeRef.current(next);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && pinchStartDist !== null) {
        pinchStartDist = null;
        if (onLiveZoomRef.current) {
          const committed = clampZoom(liveTouchZoom, min, max);
          onLiveZoomRef.current(committed, { phase: 'end', source: 'touch' });
          if (Math.abs(committed - zoomRef.current) >= 0.005) {
            onChangeRef.current(committed);
          }
        }
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('gesturestart', handleGestureStart, { passive: false });
    el.addEventListener('gesturechange', handleGestureChange, { passive: false });
    el.addEventListener('gestureend', handleGestureEnd, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      clearWheelSettle();
      el.removeAttribute('data-pinch-zoom-surface');
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
      el.removeEventListener('gestureend', handleGestureEnd);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [containerRef, enabled, min, max, wheelSettleMs]);
}

/**
 * Prevents the browser from zooming the whole web page or open modals when the user
 * pinches on a trackpad/touchscreen, double-taps, or presses Cmd/Ctrl + +/-/0 outside the gradebook canvas.
 */
export function usePreventGlobalBrowserZoom() {
  useEffect(() => {
    const isInsidePinchSurface = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('[data-pinch-zoom-surface="true"]'));

    const isFormControl = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };
    const onGesture = (e: Event) => {
      if (!isInsidePinchSurface(e.target) && !isFormControl(e.target)) {
        e.preventDefault();
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && !isInsidePinchSurface(e.target) && !isFormControl(e.target)) {
        e.preventDefault();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0') {
        e.preventDefault();
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('gesturestart', onGesture, { passive: false });
    document.addEventListener('gesturechange', onGesture, { passive: false });
    document.addEventListener('gestureend', onGesture, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('gesturestart', onGesture);
      document.removeEventListener('gesturechange', onGesture);
      document.removeEventListener('gestureend', onGesture);
      document.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}

interface ZoomControlsProps {
  zoom: number;
  onChangeZoom: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  compact?: boolean;
  className?: string;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({
  zoom,
  onChangeZoom,
  min = 0.5,
  max = 1.8,
  step = 0.1,
  compact = false,
  className = '',
}) => {
  const pct = Math.round(zoom * 100);

  return (
    <div
      role="group"
      aria-label="Controles de zoom"
      className={`inline-flex items-center rounded-xl border border-slate-200/90 bg-white/95 backdrop-blur-xs shadow-sm select-none ${
        compact
          ? 'h-7 px-1 gap-0.5 text-[11px]'
          : 'h-8 px-1.5 gap-1 text-xs touch-zoom-pill'
      } ${className}`}
    >
      <button
        type="button"
        disabled={zoom <= min + 0.005}
        onClick={() => onChangeZoom(clampZoom(zoom - step, min, max))}
        title="Alejar zoom (-)"
        aria-label="Alejar zoom"
        className="w-6 h-6 touch-zoom-btn rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35 flex items-center justify-center transition-colors"
      >
        <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => onChangeZoom(1)}
        title="Restablecer zoom al 100% (pellizca con 2 dedos)"
        aria-label={`Zoom actual ${pct}%, clic para restablecer a 100%`}
        className="min-w-[42px] px-1.5 py-0.5 touch-zoom-pct rounded-lg font-bold tabular-nums text-slate-700 hover:bg-slate-100 hover:text-blue-700 transition-colors"
      >
        {pct}%
      </button>

      <button
        type="button"
        disabled={zoom >= max - 0.005}
        onClick={() => onChangeZoom(clampZoom(zoom + step, min, max))}
        title="Acercar zoom (+)"
        aria-label="Acercar zoom"
        className="w-6 h-6 touch-zoom-btn rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35 flex items-center justify-center transition-colors"
      >
        <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
