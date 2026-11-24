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
  pointerType: string;
  activeKey: string | null;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
  lastKey: string | null;
  lastTapAt: number;
  lastTapX: number;
  lastTapY: number;
  lastClickKey: string | null;
  lastClickAt: number;
  handledDoubleTapAt: number;
}

/**
 * Reliable touch/pen double-tap detector for grid cells and interactive rows/headers.
 * iPadOS/iOS Safari frequently suppresses or delays native `dblclick` on table cells;
 * supports both pointer-based taps AND `onClick`-based consecutive touch taps so
 * double-tap never misfires on iPad Safari while preserving immediate 1-tap selection.
 */
export function useTouchDoubleTap(maxDelayMs = 540, maxDistancePx = 56) {
  const stateRef = useRef<DoubleTapState>({
    pointerId: null,
    pointerType: '',
    activeKey: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    moved: false,
    lastKey: null,
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
    lastClickKey: null,
    lastClickAt: 0,
    handledDoubleTapAt: 0,
  });

  const cancel = useCallback(() => {
    stateRef.current.pointerId = null;
    stateRef.current.activeKey = null;
    stateRef.current.moved = false;
  }, []);

  const recordPointerDown = useCallback((e: React.PointerEvent) => {
    stateRef.current.pointerType = e.pointerType || '';
  }, []);

  const start = useCallback((e: React.PointerEvent, key: string) => {
    stateRef.current.pointerType = e.pointerType || '';
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
    if (dx > 16 || dy > 16) {
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

      if (!isMatching || skip || moved || pressDuration > 470) {
        s.lastKey = null;
        s.lastTapAt = 0;
        return false;
      }

      const now = Date.now();
      const dist = Math.hypot(e.clientX - s.lastTapX, e.clientY - s.lastTapY);
      if (s.lastKey === key && now - s.lastTapAt <= maxDelayMs && dist <= maxDistancePx) {
        s.lastKey = null;
        s.lastTapAt = 0;
        s.lastClickKey = null;
        s.lastClickAt = 0;
        s.handledDoubleTapAt = now;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        window.setTimeout(() => {
          onDoubleTap(rect);
        }, 0);
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

  /**
   * Reliable iPadOS click-level fallback for touch/pen taps.
   * Because Safari always dispatches `click` on every valid tap (never on scroll),
   * consecutive taps on the same target within `maxDelayMs` reliably trigger edit even
   * if WebKit absorbed or shifted pointerup. Mouse clicks are untouched (`pointerType === 'mouse'`).
   */
  const handleTouchClick = useCallback(
    (
      key: string,
      onDoubleTap: () => void,
      isTouchDevice: boolean
    ): boolean => {
      const s = stateRef.current;
      if (s.pointerType === 'mouse') return false;
      if (!isTouchDevice && s.pointerType !== 'touch' && s.pointerType !== 'pen') {
        return false;
      }
      const now = Date.now();
      if (now - s.handledDoubleTapAt < 450) {
        return true;
      }
      if (s.lastClickKey === key && now - s.lastClickAt <= maxDelayMs) {
        s.lastClickKey = null;
        s.lastClickAt = 0;
        s.lastKey = null;
        s.lastTapAt = 0;
        s.handledDoubleTapAt = now;
        window.setTimeout(() => {
          onDoubleTap();
        }, 0);
        return true;
      }
      s.lastClickKey = key;
      s.lastClickAt = now;
      return false;
    },
    [maxDelayMs]
  );

  const wasDoubleTapJustHandled = useCallback(() => {
    return Date.now() - stateRef.current.handledDoubleTapAt < 450;
  }, []);

  return {
    recordPointerDown,
    start,
    move,
    end,
    handleTouchClick,
    cancel,
    wasDoubleTapJustHandled,
  };
}
