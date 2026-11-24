import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPwaUpdater } from './services/pwaUpdater';
import './index.css';

// Register offline-first Service Worker and auto-check updates on launch / wake
initPwaUpdater();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
