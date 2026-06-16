import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './styles/app.css';
import { App } from './App';
import { applyTheme, useUI } from './state/ui';

// Reflect the persisted/system theme before first paint to avoid a flash.
applyTheme(useUI.getState().theme);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
