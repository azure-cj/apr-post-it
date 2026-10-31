import { UserFacingError } from '@/core/types';
import { createStore, type Store } from './store';

/**
 * Something read from the tracker, with what the screens need to say about it:
 * whether it is loading, when it was read, and why it could not be.
 *
 * Tracker rows are never cached authoritatively (docs/DATA-FLOW.md): other
 * people change them. What is held here is only shared between screens for a
 * few seconds, so opening five properties in a minute is not five reads of
 * the whole Posts tab. Every write marks it stale.
 */
export interface Remote<T> {
  /** The last good read, or null before the first. Kept while a later read is under way or fails. */
  readonly data: T | null;
  /** When `data` was read (ms since 1970). */
  readonly loadedAt: number | null;
  readonly loading: boolean;
  /** Why the last read failed, as a sentence to show; null when it worked. */
  readonly error: string | null;
}

export interface RemoteResource<T> {
  readonly store: Store<Remote<T>>;
  /**
   * The data: what is held when it is younger than `maxAgeMs` (default 0:
   * always read again), else a fresh read. Calls made while a read is under
   * way share it. Rejects with the failure.
   */
  load(maxAgeMs?: number): Promise<T>;
  /** load(), with a failure left in the store for the screen to show rather than thrown. */
  refresh(maxAgeMs?: number): Promise<void>;
  /** What is held may be out of date: the next load reads again, whatever its age. */
  invalidate(): void;
  /** Forgets everything, on sign-out. A read still under way lands nowhere. */
  reset(): void;
}

const NOTHING: Remote<never> = Object.freeze({ data: null, loadedAt: null, loading: false, error: null });

export function createRemote<T>(read: () => Promise<T>, now: () => number): RemoteResource<T> {
  const store = createStore<Remote<T>>(NOTHING);
  let inFlight: Promise<T> | null = null;
  let stale = false;
  let generation = 0;

  function load(maxAgeMs = 0): Promise<T> {
    const held = store.get();
    if (!stale && held.data !== null && held.loadedAt !== null && now() - held.loadedAt < maxAgeMs) {
      return Promise.resolve(held.data);
    }
    if (inFlight) return inFlight;

    const started = generation;
    stale = false;
    store.set((s) => (s.loading ? s : { ...s, loading: true }));
    const p = read().then(
      (data) => {
        if (started === generation) store.set({ data, loadedAt: now(), loading: false, error: null });
        return data;
      },
      (err: unknown) => {
        if (started === generation) store.set((s) => ({ ...s, loading: false, error: sentenceOf(err) }));
        throw err;
      },
    );
    inFlight = p;
    const settle = () => {
      if (inFlight === p) inFlight = null;
    };
    p.then(settle, settle);
    return p;
  }

  return {
    store,
    load,
    refresh: (maxAgeMs) => load(maxAgeMs).then(
      () => undefined,
      () => undefined,
    ),
    invalidate() {
      stale = true;
    },
    reset() {
      generation++;
      inFlight = null;
      stale = false;
      store.set(NOTHING);
    },
  };
}

/** Said when something fails that should not have: a bug, not a refusal. */
export const UNEXPECTED =
  'Something went wrong that Post-It did not expect. Try again, and tell your admin if it keeps happening.';

/**
 * The sentence to show for a failure. A UserFacingError is shown exactly as
 * written: its words were chosen for the person reading them. Anything else
 * is a bug, logged for whoever fixes it and summarised for whoever hit it.
 */
export function sentenceOf(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  console.error(err);
  return UNEXPECTED;
}
