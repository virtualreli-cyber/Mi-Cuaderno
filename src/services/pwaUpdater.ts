import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export const APP_BUILD_LABEL: string =
  typeof __APP_BUILD__ === 'string' && __APP_BUILD__ ? __APP_BUILD__ : 'dev';

let swRegistration: ServiceWorkerRegistration | undefined;
let lastUpdateCheck = 0;
let updateAvailableFlag = false;
let updatingInProgress = false;
let reloadingForUpdate = false;
let initialized = false;

const listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of listeners) fn();
}

function getRunningMainScriptPath(): string | null {
  if (typeof document === 'undefined') return null;
  const scripts = Array.from(document.querySelectorAll('script[src]'));
  for (const s of scripts) {
    const src = s.getAttribute('src') ?? '';
    if (src.includes('index-') && src.endsWith('.js')) {
      return src.replace(/^\.\//, '');
    }
  }
  return null;
}

async function detectRemoteAssetUpdate(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const currentScript = getRunningMainScriptPath();
  if (!currentScript) return false;
  try {
    const res = await fetch(`./index.html?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return false;
    const html = await res.text();
    const match = html.match(/src=["']\.?\/?(assets\/index-[^"']+\.js)["']/);
    const remoteScript = match?.[1];
    if (remoteScript && remoteScript !== currentScript) {
      return true;
    }
  } catch {
    // Ignore transient network errors while offline
  }
  return false;
}

export async function forceUpdateAppNow(): Promise<void> {
  if (typeof window === 'undefined' || updatingInProgress) return;
  updatingInProgress = true;
  notifyListeners();
  try {
    if ('serviceWorker' in navigator) {
      const reg = swRegistration ?? (await navigator.serviceWorker.getRegistration('./'));
      if (reg) {
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        try {
          await reg.update();
        } catch {
          // ignore
        }
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if (reg) {
        await reg.unregister().catch(() => false);
      }
    }
  } catch {
    // Fallback to direct cache-busted reload
  } finally {
    window.location.reload();
  }
}

function canAutoReloadSafely(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (
    active &&
    (active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.tagName === 'SELECT' ||
      active.isContentEditable)
  ) {
    return false;
  }
  if (document.querySelector('dialog[open]')) {
    return false;
  }
  return true;
}

export async function checkForAppUpdate(force = false): Promise<boolean> {
  if (!import.meta.env.PROD || typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const now = Date.now();
  if (!force && now - lastUpdateCheck < 15_000) return updateAvailableFlag;
  lastUpdateCheck = now;

  try {
    if (swRegistration) {
      await swRegistration.update().catch(() => undefined);
    }
    if (swRegistration?.waiting) {
      updateAvailableFlag = true;
      notifyListeners();
      swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    }

    const remoteChanged = await detectRemoteAssetUpdate();
    if (remoteChanged) {
      updateAvailableFlag = true;
      notifyListeners();
      window.dispatchEvent(new CustomEvent('cuaderno:update-available'));
      // On iPadOS Safari standalone PWAs, Workbox/HTTP cache on sw.js can hold an old bundle;
      // trigger an automatic clean cache+SW refresh when the user is idle (no modal/input active).
      if (canAutoReloadSafely()) {
        await forceUpdateAppNow();
      }
      return true;
    }
  } catch {
    // Ignore errors
  }
  return false;
}

export function initPwaUpdater(): void {
  if (initialized) return;
  initialized = true;
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // Ensure registration uses updateViaCache: 'none' so iOS/Safari ignores GitHub Pages max-age=600 on sw.js
  navigator.serviceWorker
    .register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then((reg) => {
      swRegistration = reg;
      reg.addEventListener('updatefound', () => {
        const nextWorker = reg.installing;
        if (!nextWorker) return;
        nextWorker.addEventListener('statechange', () => {
          if (nextWorker.state === 'installed' && navigator.serviceWorker.controller) {
            updateAvailableFlag = true;
            notifyListeners();
            nextWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    })
    .catch(() => {
      // Fallback handled by registerSW below
    });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  registerSW({
    immediate: true,
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('cuaderno:offline-ready'));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      swRegistration = registration;
      void checkForAppUpdate(true);
      window.setInterval(() => {
        void checkForAppUpdate(false);
      }, 2 * 60 * 1000);
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForAppUpdate(false);
    }
  });
  window.addEventListener('focus', () => {
    void checkForAppUpdate(false);
  });
  window.addEventListener('online', () => {
    void checkForAppUpdate(true);
  });
}

export function usePwaUpdateStatus() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return {
    buildLabel: APP_BUILD_LABEL,
    updateAvailable: updateAvailableFlag,
    updating: updatingInProgress,
    checkNow: () => checkForAppUpdate(true),
    applyUpdateNow: () => forceUpdateAppNow(),
  };
}
