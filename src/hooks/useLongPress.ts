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

interface DoubleTapState {
  pointerId: number | null;
  activeKey: string | null;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
  lastKey: string | null;
  lastTapAt: number;
  lastTapX: number;
  lastTapY: number;
  handledDoubleTapAt: number;
}

/**
 * Reliable touch/pen double-tap detector for grid cells and interactive rows/headers.
 * iPadOS/iOS Safari frequently suppresses or delays native `dblclick` on table cells;
 * this fires cleanly on the second fast tap while preserving immediate single-tap selection.
 */
export function useTouchDoubleTap(maxDelayMs = 380, maxDistancePx = 32) {
  const stateRef = useRef<DoubleTapState>({
    pointerId: null,
    activeKey: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    moved: false,
    lastKey: null,
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
    handledDoubleTapAt: 0,
  });

  const cancel = useCallback(() => {
    stateRef.current.pointerId = null;
    stateRef.current.activeKey = null;
    stateRef.current.moved = false;
  }, []);

  const start = useCallback((e: React.PointerEvent, key: string) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (!e.isPrimary) {
      stateRef.current.moved = true;
      return;
    }
    stateRef.current.pointerId = e.pointerId;
    stateRef.current.activeKey = key;
    stateRef.current.startX = e.clientX;
    stateRef.current.startY = e.clientY;
    stateRef.current.startTime = Date.now();
    stateRef.current.moved = false;
  }, []);

  const move = useCallback((e: React.PointerEvent) => {
    const s = stateRef.current;
    if (s.pointerId !== e.pointerId || s.moved) return;
    const dx = Math.abs(e.clientX - s.startX);
    const dy = Math.abs(e.clientY - s.startY);
    if (dx > 12 || dy > 12) {
      s.moved = true;
    }
  }, []);

  const end = useCallback(
    (
      e: React.PointerEvent,
      key: string,
      onDoubleTap: (rect: DOMRect) => void,
      skip?: boolean
    ) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return false;
      const s = stateRef.current;
      const isMatching = s.pointerId === e.pointerId && s.activeKey === key;
      const pressDuration = Date.now() - s.startTime;
      const moved = s.moved;
      s.pointerId = null;
      s.activeKey = null;
      s.moved = false;

      if (!isMatching || skip || moved || pressDuration > 450) {
        s.lastKey = null;
        s.lastTapAt = 0;
        return false;
      }

      const now = Date.now();
      const dist = Math.hypot(e.clientX - s.lastTapX, e.clientY - s.lastTapY);
      if (s.lastKey === key && now - s.lastTapAt <= maxDelayMs && dist <= maxDistancePx) {
        s.lastKey = null;
        s.lastTapAt = 0;
        s.handledDoubleTapAt = now;
        onDoubleTap((e.currentTarget as HTMLElement).getBoundingClientRect());
        return true;
      }

      s.lastKey = key;
      s.lastTapAt = now;
      s.lastTapX = e.clientX;
      s.lastTapY = e.clientY;
      return false;
    },
    [maxDelayMs, maxDistancePx]
  );

  const wasDoubleTapJustHandled = useCallback(() => {
    return Date.now() - stateRef.current.handledDoubleTapAt < 450;
  }, []);

  return {
    start,
    move,
    end,
    cancel,
    wasDoubleTapJustHandled,
  };
}
