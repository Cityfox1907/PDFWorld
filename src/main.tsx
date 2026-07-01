import './lib/polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './styles/app.css';
import { App } from './App';
import { applyTheme, useUI } from './state/ui';
import { useStore } from './state/store';
import { injectFontFaces } from './lib/pdf';

// Reflect the persisted/system theme before first paint to avoid a flash.
applyTheme(useUI.getState().theme);

// Dev-only hook for the headless end-to-end tests (scripts/e2e): lets the test
// driver read editor state and trigger an export. Never part of a production build.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__pdfworldStore = useStore;
}

// Register the @font-face rules for the font catalogue (files load lazily on use).
injectFontFaces();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
