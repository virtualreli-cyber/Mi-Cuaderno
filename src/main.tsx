import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

// Register offline-first Service Worker in production builds (auto-updates silently when online)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let swRegistration: ServiceWorkerRegistration | undefined;
  let lastUpdateCheck = 0;

  const checkForAppUpdate = () => {
    if (!swRegistration || !navigator.onLine) return;
    const now = Date.now();
    if (now - lastUpdateCheck < 15_000) return;
    lastUpdateCheck = now;
    void swRegistration.update().catch(() => {
      // Ignore transient offline/network update-check errors
    });
  };

  registerSW({
    immediate: true,
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('cuaderno:offline-ready'));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      swRegistration = registration;
      checkForAppUpdate();
      window.setInterval(checkForAppUpdate, 5 * 60 * 1000);
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForAppUpdate();
    }
  });
  window.addEventListener('focus', checkForAppUpdate);
  window.addEventListener('online', checkForAppUpdate);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
