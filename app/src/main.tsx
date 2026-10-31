import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './theme/base.css';
import { setPlatform, type Platform } from './platform';
import { App } from './ui/App';
import { AppStateProvider } from './ui/state';

/**
 * Tauri's platform inside the app; in a plain browser, the demo: an in-memory
 * web app with a realistic library, so `npm run dev` runs everything. Each is
 * loaded only where it is used, so the browser never loads Tauri's modules
 * and the desktop app never runs the demo.
 */
async function choosePlatform(): Promise<{ readonly platform: Platform; readonly demo: boolean }> {
  if ('__TAURI_INTERNALS__' in window) {
    const { createTauriPlatform } = await import('./platform/tauri');
    return { platform: createTauriPlatform(), demo: false };
  }
  const { createDemoPlatform } = await import('./platform/demo-data');
  // ?as=manager opens the demo signed in as someone else; ?as= opens it signed out.
  const as = new URLSearchParams(window.location.search).get('as');
  return { platform: createDemoPlatform({ signedInAs: as === null ? 'intern' : as.trim() || null }), demo: true };
}

async function start(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('index.html has no #root element.');
  const { platform, demo } = await choosePlatform();
  setPlatform(platform);
  createRoot(root).render(
    <StrictMode>
      <AppStateProvider platform={platform}>
        <App demo={demo} />
      </AppStateProvider>
    </StrictMode>,
  );
}

void start();
