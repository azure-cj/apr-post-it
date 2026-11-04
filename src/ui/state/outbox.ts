import { EMPTY_OUTBOX, keepsForRetry, OUTBOX_KEY, readOutbox, type KeptPost, type Outbox } from '@/core/outbox';
import type { LogPostInput, Tracker } from '@/core/tracker';
import type { Platform } from '@/platform';
import { sentenceOf } from './remote';
import { createStore, type Store } from './store';

/** The posts kept on this PC until the web app saves them (core/outbox.ts). */
export interface OutboxService {
  /** What is kept and what was refused, for every person who used this PC. */
  readonly state: Store<Outbox>;
  /** Reads what this PC kept from before. Never rejects. */
  load(): Promise<void>;
  /** Keeps a post whose save failed on the way, dated now, for `who`. */
  keep(input: LogPostInput, who: string, why: unknown): Promise<void>;
  /**
   * Sends `who`'s kept posts, oldest first. Saved ones leave; one the web app
   * refuses moves to `refused`, to be shown; one that fails on the way again
   * stays. Resolves with how many were saved. Never rejects.
   */
  flush(who: string): Promise<number>;
  /** Removes a refused post from view. */
  dismiss(id: string): Promise<void>;
}

export function createOutbox(p: Pick<Platform, 'readLocal' | 'writeLocal'>, tracker: Pick<Tracker, 'logPost'>, now: () => number): OutboxService {
  const state = createStore<Outbox>(EMPTY_OUTBOX);
  let sending = false;

  const save = async (next: Outbox): Promise<void> => {
    state.set(next);
    try {
      await p.writeLocal(OUTBOX_KEY, JSON.stringify(next));
    } catch {
      // Kept in memory for this run; the next change tries to write it again.
    }
  };

  return {
    state,

    async load() {
      try {
        state.set(readOutbox(await p.readLocal(OUTBOX_KEY)));
      } catch {
        // Nothing readable on this PC: start empty.
      }
    },

    async keep(input, who, why) {
      const at = now();
      const post: KeptPost = {
        id: `${at}-${Math.random().toString(36).slice(2, 8)}`,
        who,
        input: { ...input, loggedAt: undefined },
        loggedAt: new Date(at).toISOString(),
        tries: 1,
        lastError: sentenceOf(why),
      };
      const current = state.get();
      await save({ ...current, kept: [...current.kept, post] });
    },

    async flush(who) {
      if (sending) return 0;
      sending = true;
      let saved = 0;
      try {
        for (const post of state.get().kept.filter((k) => k.who === who)) {
          try {
            await tracker.logPost({ ...post.input, loggedAt: post.loggedAt });
            saved++;
            const current = state.get();
            await save({ ...current, kept: current.kept.filter((k) => k.id !== post.id) });
          } catch (err) {
            const current = state.get();
            const others = current.kept.filter((k) => k.id !== post.id);
            if (keepsForRetry(err)) {
              const tried: KeptPost = { ...post, tries: post.tries + 1, lastError: sentenceOf(err) };
              await save({ ...current, kept: current.kept.map((k) => (k.id === post.id ? tried : k)) });
              // Still no way through: the rest would fail the same way. Try again later.
              break;
            }
            const refused = { id: post.id, who, title: post.input.propertyName, message: sentenceOf(err) };
            await save({ kept: others, refused: [...current.refused, refused] });
          }
        }
      } finally {
        sending = false;
      }
      return saved;
    },

    async dismiss(id) {
      const current = state.get();
      await save({ ...current, refused: current.refused.filter((r) => r.id !== id) });
    },
  };
}
