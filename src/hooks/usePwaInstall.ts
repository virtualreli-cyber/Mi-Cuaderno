import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface NavigatorWithInstall extends Navigator {
  install?: () => Promise<void>;
  standalone?: boolean;
}

export interface PwaInstallState {
  isStandalone: boolean;
  canPromptInstall: boolean;
  isIosNonStandalone: boolean;
  installStatusMessage: string | null;
  installing: boolean;
  triggerInstall: () => Promise<void>;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((window.navigator as NavigatorWithInstall).standalone)
  );
}

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Progressive Web App installation hook following modern Web Install API (`navigator.install()`)
 * with `beforeinstallprompt` fallback, hiding install UI when unsupported.
 */
export function usePwaInstall(): PwaInstallState {
  const [isStandalone, setIsStandalone] = useState<boolean>(detectStandalone);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installStatusMessage, setInstallStatusMessage] = useState<string | null>(null);

  const supportsWebInstall =
    typeof navigator !== 'undefined' &&
    typeof (navigator as NavigatorWithInstall).install === 'function';

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => setIsStandalone(detectStandalone());
    mq.addEventListener?.('change', onDisplayChange);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      setInstallStatusMessage('App instalada correctamente.');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      mq.removeEventListener?.('change', onDisplayChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const nav = navigator as NavigatorWithInstall;
      if (typeof nav.install === 'function') {
        await nav.install();
        setInstallStatusMessage('App instalada o abierta.');
        setDeferredPrompt(null);
      } else if (deferredPrompt) {
        const promptEv = deferredPrompt;
        setDeferredPrompt(null);
        await promptEv.prompt();
        const { outcome } = await promptEv.userChoice;
        setInstallStatusMessage(
          outcome === 'accepted'
            ? 'App instalada correctamente.'
            : 'Instalación cancelada.'
        );
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setInstallStatusMessage('Instalación cancelada.');
      } else {
        setInstallStatusMessage('No se pudo iniciar la instalación.');
      }
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt, installing]);

  const canPromptInstall = !isStandalone && (supportsWebInstall || Boolean(deferredPrompt));
  const isIosNonStandalone = !isStandalone && detectIos();

  return {
    isStandalone,
    canPromptInstall,
    isIosNonStandalone,
    installStatusMessage,
    installing,
    triggerInstall,
  };
}
