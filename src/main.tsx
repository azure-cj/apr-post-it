import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './theme/base.css';
import { setPlatform, type Platform } from './platform';
import { App } from './ui/App';
import { AppStateProvider } from './ui/state';
import { applySavedTheme } from './ui/state/theme';

/**
 * Tauri's platform inside the app. In a plain browser during development, the
 * browser platform, which talks to the real web app with a real key: there is
 * no sample data. Each is loaded only where it is used, so the browser never
 * loads Tauri's modules.
 *
 * The browser platform is development only: `import.meta.env.DEV` is false in
 * a production build, so the branch is left out of it entirely. A production
 * build opened in a browser says where to open it instead.
 */
async function choosePlatform(): Promise<Platform | null> {
  if ('__TAURI_INTERNALS__' in window) {
    const { createTauriPlatform } = await import('./platform/tauri');
    return createTauriPlatform();
  }
  if (import.meta.env.DEV) {
    const { createBrowserPlatform } = await import('./platform/browser');
    return createBrowserPlatform();
  }
  return null;
}

async function start(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('index.html has no #root element.');
  const platform = await choosePlatform();
  if (!platform) {
    showOutsideTheApp(root);
    return;
  }
  setPlatform(platform);
  // Before the first render, so the first frame is already in the chosen theme.
  await applySavedTheme(platform);
  createRoot(root).render(
    <StrictMode>
      <AppStateProvider platform={platform}>
        <App />
      </AppStateProvider>
    </StrictMode>,
  );
}

/** The built app outside the desktop: nothing to talk to, so one sentence. */
function showOutsideTheApp(root: HTMLElement): void {
  const message = document.createElement('p');
  message.className = 'outside-the-app';
  message.textContent = 'Open APG Post-It from the desktop app.';
  root.replaceChildren(message);
}

void start();
