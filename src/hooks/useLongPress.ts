import { useCallback, useRef } from 'react';

interface LongPressState {
  timer: number | null;
  startX: number;
  startY: number;
  pointerId: number | null;
  firedAt: number;
}

/**
 * Reusable touch/pen long-press controller for grid cells, headers, student rows, and cards.
 * Only activates for touch/pen pointers so mouse desktop behavior is 100% unaffected.
 * Cancels immediately if finger moves more than 10px (so scrolling/panning never misfires).
 */
export function useTouchLongPress(delayMs = 480, moveTolerancePx = 10) {
  const stateRef = useRef<LongPressState>({
    timer: null,
    startX: 0,
    startY: 0,
    pointerId: null,
    firedAt: 0,
  });

  const cancel = useCallback(() => {
    if (stateRef.current.timer !== null) {
      window.clearTimeout(stateRef.current.timer);
      stateRef.current.timer = null;
    }
    stateRef.current.pointerId = null;
  }, []);

  const start = useCallback(
    (e: React.PointerEvent, onTrigger: (anchorRect: DOMRect) => void) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      cancel();
      const targetEl = e.currentTarget as HTMLElement;
      stateRef.current.startX = e.clientX;
      stateRef.current.startY = e.clientY;
      stateRef.current.pointerId = e.pointerId;
      stateRef.current.timer = window.setTimeout(() => {
        stateRef.current.timer = null;
        stateRef.current.pointerId = null;
        stateRef.current.firedAt = Date.now();
        // Subtle vibration feedback on Android devices when available
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try {
            navigator.vibrate(14);
          } catch {
            // ignore unsupported vibration
          }
        }
        onTrigger(targetEl.getBoundingClientRect());
      }, delayMs);
    },
    [cancel, delayMs]
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      const s = stateRef.current;
      if (s.timer === null || s.pointerId !== e.pointerId) return;
      const dx = Math.abs(e.clientX - s.startX);
      const dy = Math.abs(e.clientY - s.startY);
      if (dx > moveTolerancePx || dy > moveTolerancePx) {
        cancel();
      }
    },
    [cancel, moveTolerancePx]
  );

  const wasJustTriggered = useCallback(() => {
    return Date.now() - stateRef.current.firedAt < 450;
  }, []);

  return {
    start,
    move,
    cancel,
    wasJustTriggered,
  };
}
