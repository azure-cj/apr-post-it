import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppUpdate, Platform } from '@/platform';
import { Button, Notice } from './components';
import './UpdateBanner.css';

/** The first check, a little after start so the window opens first. */
export const FIRST_CHECK_MS = 5_000;
/** How often to check again while the app is open. */
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

type State =
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly update: AppUpdate }
  | { readonly kind: 'installing'; readonly update: AppUpdate; readonly share: number | null }
  | { readonly kind: 'failed'; readonly update: AppUpdate };

/**
 * A newer version from the releases repo: offered, never forced, so nobody
 * loses a half-logged post. Checked on start and every few hours; a failed
 * check says nothing and tries again later. "Later" hides it until a newer
 * version than the one dismissed. Restarting goes through `requestLeave`, so
 * unsaved changes are asked about first.
 */
/** What a check found: a newer version (now offered), none, or no answer. */
export type CheckResult = 'found' | 'none' | 'failed';

export function UpdateBanner({
  platform,
  requestLeave,
  now = Date.now,
  onCheckReady,
}: {
  readonly platform: Pick<Platform, 'checkUpdate'>;
  /** Runs `go` now, or after asking when there are unsaved changes. */
  readonly requestLeave: (go: () => void) => void;
  readonly now?: () => number;
  /** Hands over a check to run on demand (Check for updates), which also offers a version put off with Later. */
  readonly onCheckReady?: ((checkNow: () => Promise<CheckResult>) => void) | undefined;
}) {
  const [state, setState] = useState<State>({ kind: 'none' });
  const dismissed = useRef<string | null>(null);
  const busy = useRef(false);

  const check = useCallback(
    async (asked = false): Promise<CheckResult> => {
      if (busy.current) return 'found';
      try {
        const update = await platform.checkUpdate();
        if (!update) return 'none';
        if (asked) dismissed.current = null;
        if (update.version === dismissed.current) return 'none';
        setState((s) => (s.kind === 'installing' ? s : { kind: 'ready', update }));
        return 'found';
      } catch {
        // Offline, or the releases repo didn't answer: try again at the next check.
        return 'failed';
      }
    },
    [platform],
  );

  useEffect(() => {
    onCheckReady?.(() => check(true));
  }, [onCheckReady, check]);

  // On start, then every few hours. Checked every minute against the clock, so
  // a laptop waking from sleep catches up.
  useEffect(() => {
    let last = now();
    const first = setTimeout(() => void check(), FIRST_CHECK_MS);
    const timer = setInterval(() => {
      if (now() - last < CHECK_EVERY_MS) return;
      last = now();
      void check();
    }, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [check, now]);

  const install = (update: AppUpdate) => {
    busy.current = true;
    setState({ kind: 'installing', update, share: null });
    update
      .install((share) => setState((s) => (s.kind === 'installing' ? { ...s, share } : s)))
      .catch(() => setState({ kind: 'failed', update }))
      .finally(() => {
        busy.current = false;
      });
  };

  if (state.kind === 'none') return null;
  const { update } = state;

  if (state.kind === 'installing') {
    const percent = state.share === null ? null : Math.round(state.share * 100);
    return (
      <Notice tone="info" live className="update-banner" title={`Updating to ${update.version}…`}>
        {percent === null ? 'Downloading.' : `${percent}%. Post-It restarts when it's done.`}
      </Notice>
    );
  }

  const later = () => {
    dismissed.current = update.version;
    setState({ kind: 'none' });
  };

  return (
    <Notice
      tone={state.kind === 'failed' ? 'warn' : 'info'}
      live
      className="update-banner"
      title={state.kind === 'failed' ? "The update didn't install" : `Version ${update.version} is ready`}
      action={
        <div className="update-banner__actions">
          <Button size="small" variant="quiet" onClick={later}>
            Later
          </Button>
          <Button size="small" onClick={() => requestLeave(() => install(update))}>
            {state.kind === 'failed' ? 'Try again' : 'Restart and update'}
          </Button>
        </div>
      }
    >
      {state.kind === 'failed' ? 'Check your connection, then try again.' : update.notes || 'Post-It restarts to update.'}
    </Notice>
  );
}
