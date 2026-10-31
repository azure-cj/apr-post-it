import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './theme/base.css';
import { setPlatform, type Platform } from './platform';
import { App } from './ui/App';
import { AppStateProvider } from './ui/state';

/**
 * Tauri's platform inside the app. In a plain browser during development, the
 * demo: an in-memory web app with a realistic library, so `npm run dev` runs
 * everything. Each is loaded only where it is used, so the browser never loads
 * Tauri's modules and the desktop app never runs the demo.
 *
 * The demo is development only: `import.meta.env.DEV` is false in a production
 * build, so the branch and the demo's data are left out of it entirely. A
 * production build opened in a browser says where to open it instead.
 */
async function choosePlatform(): Promise<{ readonly platform: Platform; readonly signInNote?: ReactNode } | null> {
  if ('__TAURI_INTERNALS__' in window) {
    const { createTauriPlatform } = await import('./platform/tauri');
    return { platform: createTauriPlatform() };
  }
  if (import.meta.env.DEV) {
    const [{ createDemoPlatform }, { DevKeysNote }] = await Promise.all([
      import('./platform/demo-data'),
      import('./ui/dev/DevKeysNote'),
    ]);
    const params = new URLSearchParams(window.location.search);
    // ?as=manager opens the demo signed in as someone else; ?as= opens it signed out.
    const as = params.get('as');
    return {
      platform: createDemoPlatform({
        signedInAs: as === null ? 'intern' : as.trim() || null,
        // ?titlebar draws the desktop window's controls, which do nothing here.
        windowControls: params.has('titlebar'),
      }),
      signInNote: <DevKeysNote />,
    };
  }
  return null;
}

async function start(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('index.html has no #root element.');
  const chosen = await choosePlatform();
  if (!chosen) {
    showOutsideTheApp(root);
    return;
  }
  const { platform, signInNote } = chosen;
  setPlatform(platform);
  createRoot(root).render(
    <StrictMode>
      <AppStateProvider platform={platform}>
        <App signInNote={signInNote} />
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
