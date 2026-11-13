import { createBackend, type Action, type Backend, type Payload, type Reply } from '@/core/backend';
import { createDirectory, type Directory } from '@/core/directory';
import { readServerInfo, serverVersionStatus } from '@/core/session';
import { createTracker, type Tracker } from '@/core/tracker';
import type { Highlight } from '@/core/highlights';
import type { ReportedPost } from '@/core/refused';
import type { SpotCheck } from '@/core/spotchecks';
import {
  canManage,
  type Assignment,
  type PostLogEntry,
  type PropertyDetail,
  type ServerRules,
  type ServerVersionStatus,
  type TeamMember,
  type User,
  UserFacingError,
} from '@/core/types';
import type { Platform } from '@/platform';
import type { FirebaseAccess } from '@/platform/firebase';
import { createOutbox, type OutboxService } from './outbox';
import { createRemote, sentenceOf, type RemoteResource } from './remote';
import type { AppSettings } from './settings';
import { createStore, type Store } from './store';

/** How the property list's refresh is going, for the Find screen to say. */
export interface DirectoryStatus {
  /** A refresh is under way. */
  readonly refreshing: boolean;
  /** Why the last refresh failed, as a sentence; null when it worked. */
  readonly error: string | null;
  /** When the last refresh finished, whether or not it worked (ms since 1970). */
  readonly lastAttempt: number | null;
}

/** How Find orders its results. "best" is Best match while searching, and Name otherwise. */
export type FindSort = 'best' | 'name' | 'newest' | 'posted';

/** Find's Filter menu: each one narrows the list while it is on. */
export interface FindFilters {
  readonly sale: boolean;
  readonly lease: boolean;
  /** Not in cooldown, not sold, and has a document. */
  readonly ready: boolean;
  readonly fresh: boolean;
  readonly photos: boolean;
}

/** What the Find screen was showing, kept while you open a listing and come back. */
export interface FindState {
  readonly query: string;
  /** A category as components' categoryKind gives it ('warehouse', 'condo', …), or '' for all. */
  readonly category: string;
  readonly filters: FindFilters;
  readonly sort: FindSort;
  /** The page of results, from 1. */
  readonly page: number;
  /** The listing last opened from Find, so coming back puts focus on its row. */
  readonly opened: string;
}

/** What the server said about itself in its last `ping`. */
export interface ServerState {
  /** True once a ping has been answered since sign-in. */
  readonly known: boolean;
  /** Code.gs's SERVER_VERSION; blank from a server that sends none. */
  readonly version: string;
  /** How that compares with EXPECTED_SERVER_VERSION (src/config.ts). */
  readonly versionStatus: ServerVersionStatus;
  /**
   * The live rules (cooldown, repost age, listings per week). Null until a ping
   * is answered, or from a server that sends none: then the settings' own
   * apply. Use withServerRules (./settings) to put them over the settings.
   */
  readonly rules: ServerRules | null;
}

export const NO_FIND_FILTERS: FindFilters = Object.freeze({ sale: false, lease: false, ready: false, fresh: false, photos: false });
export const EMPTY_FIND: FindState = Object.freeze({
  query: '',
  category: '',
  filters: NO_FIND_FILTERS,
  sort: 'best',
  page: 1,
  opened: '',
});
const IDLE: DirectoryStatus = Object.freeze({ refreshing: false, error: null, lastAttempt: null });
const UNKNOWN_SERVER: ServerState = Object.freeze({ known: false, version: '', versionStatus: 'unknown', rules: null });

/** Everything the screens use that is not React: built once per window. */
export interface Services {
  readonly backend: Backend;
  readonly directory: Directory;
  /** The tracker. Every write marks the posts and queues held below as stale. */
  readonly tracker: Tracker;
  readonly directoryStatus: Store<DirectoryStatus>;
  /** The server's version and rules, from every ping made through `backend` (sign-in included). */
  readonly server: Store<ServerState>;
  /** Pings the server now, for its version and rules. Never rejects. */
  refreshServer(): Promise<void>;
  /** The Posts rows you may see: an intern's own, everyone's for a manager. Shared for a few seconds. */
  readonly posts: RemoteResource<readonly PostLogEntry[]>;
  /** The Assignments rows you may see. Shared for a few seconds. */
  readonly assignments: RemoteResource<readonly Assignment[]>;
  /** The Team tab (Admin only): names, roles, FB accounts, active. Never keys. */
  readonly team: RemoteResource<readonly TeamMember[]>;
  /** The Spot checks tab (Admin only, v16). */
  readonly spotChecks: RemoteResource<readonly SpotCheck[]>;
  /** The Refused posts tab (Admin only, v18). */
  readonly refusedPosts: RemoteResource<readonly ReportedPost[]>;
  /** The highlighted listings (everyone, v19). */
  readonly highlights: RemoteResource<readonly Highlight[]>;
  readonly find: Store<FindState>;
  /** Where each listing's photos were saved this session, by property id: for Open folder. */
  readonly savedFolders: Store<ReadonlyMap<string, string>>;
  /** Posts kept on this PC until the web app saves them. Kept through sign-out: each is its person's. */
  readonly outbox: OutboxService;
  /** Fetches the property list now and records how it went. Never rejects. */
  refreshDirectory(): Promise<void>;
  /**
   * On sign-in: the list from disk at once when there is one, then a fresh
   * one; and the server's version and rules, when no ping has told them yet.
   * Never rejects.
   */
  startDirectory(): Promise<void>;
  /** A listing as this person may see it: see `forViewer`. */
  openProperty(id: string, viewer: User): Promise<PropertyDetail>;
  /**
   * Claude's reword of a posting text (AID-129), through Post-It's `paraphrase`
   * function on the hub's key and within the hub's limits. Send only what Copy
   * would copy: never the internal section. Rejects with a sentence (a limit
   * reached, Claude off or down).
   */
  reword(text: string): Promise<string>;
  /** Forgets everything held for the person signing out. The key is the caller's to remove. */
  forget(): void;
}

export function createServices(
  p: Platform,
  getSettings: () => AppSettings,
  now: () => number,
  /** Firebase, when sign-in goes by account: its token is sent instead of a key. Null: by key. */
  getFirebase: () => FirebaseAccess | null = () => null,
): Services {
  // The link and the credential are read before every call, so a link changed
  // in Settings applies at once and neither lives in React state.
  const inner = createBackend({
    post: p.post,
    getConfig: async () => {
      const url = getSettings().scriptUrl;
      const firebase = getFirebase();
      if (!firebase) return { url, key: await p.readKey() };
      const signedIn = await firebase.token();
      return { url, idToken: signedIn?.token ?? null, who: signedIn?.uid ?? null };
    },
  });
  const server = createStore<ServerState>(UNKNOWN_SERVER);
  // Every ping answered through here says what the server is and its rules.
  const backend: Backend = {
    ...inner,
    async call<T extends object = Reply>(action: Action, payload?: Payload): Promise<T> {
      const reply = await inner.call<T>(action, payload);
      if (action === 'ping') noteServer(reply as Reply);
      return reply;
    },
  };

  /**
   * The server's version and rules from a ping. Never throws: the sign-in it
   * came with matters more. A ping that says nothing new keeps the state it
   * had, so its readers (and the settings derived from it) don't re-render.
   */
  function noteServer(reply: Reply): void {
    let next: ServerState;
    try {
      const info = readServerInfo(reply);
      next = { known: true, version: info.version, versionStatus: serverVersionStatus(info.version), rules: info.rules };
    } catch {
      next = { ...UNKNOWN_SERVER, known: true };
    }
    server.set((current) => (sameServer(current, next) ? current : next));
  }

  async function refreshServer(): Promise<void> {
    try {
      await backend.call('ping');
    } catch {
      // Kept as it was: the rules already known, or the settings' own.
    }
  }
  const directory = createDirectory({ backend, store: p, now });
  const raw = createTracker({ backend });

  const posts = createRemote(() => raw.posts(), now);
  const assignments = createRemote(() => raw.assignments(), now);
  const team = createRemote(() => raw.team(), now);
  const spotChecks = createRemote(() => raw.spotChecks(), now);
  const refusedPosts = createRemote(() => raw.refusedPosts(), now);
  const highlights = createRemote(() => raw.highlights(), now);

  /**
   * After a write, or an attempt at one: what was read before may no longer
   * be true. A write that timed out may still have gone through, so this runs
   * whichever way it ended. The queue is read again at once (it drives the
   * count in the nav); the posts when a screen next asks.
   */
  const afterWrite = (): void => {
    posts.invalidate();
    assignments.invalidate();
    void assignments.refresh();
  };

  /** A change to the Team tab: the team is read again whichever way it ended. */
  async function teamWrite<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } finally {
      team.invalidate();
      void team.refresh();
    }
  }

  async function writing<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } finally {
      afterWrite();
    }
  }

  const tracker: Tracker = {
    posts: () => raw.posts(),
    team: () => raw.team(),
    assignments: () => raw.assignments(),
    logPost: (input) => writing(() => raw.logPost(input)),
    addLink: (post, link) => writing(() => raw.addLink(post, link)),
    updatePost: (original, edited) => writing(() => raw.updatePost(original, edited)),
    saveQueue: (week, assignedTo, items, when) => writing(() => raw.saveQueue(week, assignedTo, items, when)),
    setStatus: (item, status) => writing(() => raw.setStatus(item, status)),
    saveQueues: (week, queues, when) => writing(() => raw.saveQueues(week, queues, when)),
    addPerson: (input) => teamWrite(() => raw.addPerson(input)),
    setActive: (name, active) => teamWrite(() => raw.setActive(name, active)),
    updatePerson: (name, changes) => teamWrite(() => raw.updatePerson(name, changes)),
    newKey: (name) => teamWrite(() => raw.newKey(name)),
    indexCheck: () => raw.indexCheck(),
    async setRules(changes) {
      const rules = await raw.setRules(changes);
      server.set((s) => (sameRules(s.rules, rules) ? s : { ...s, rules }));
      return rules;
    },
    rebuildDirectory: () => raw.rebuildDirectory(),
    directoryStatus: () => raw.directoryStatus(),
    spotChecks: () => raw.spotChecks(),
    async saveSpotCheck(post, result) {
      try {
        return await raw.saveSpotCheck(post, result);
      } finally {
        spotChecks.invalidate();
        void spotChecks.refresh();
      }
    },
    highlights: () => raw.highlights(),
    async setHighlight(input) {
      try {
        const list = await raw.setHighlight(input);
        highlights.store.set({ data: list, loadedAt: now(), loading: false, error: null });
        return list;
      } catch (err) {
        highlights.invalidate();
        void highlights.refresh();
        throw err;
      }
    },
    refusedPosts: () => raw.refusedPosts(),
    async handleRefused(post) {
      try {
        return await raw.handleRefused(post);
      } finally {
        refusedPosts.invalidate();
        void refusedPosts.refresh();
      }
    },
  };

  const outbox = createOutbox(p, tracker, now);
  const directoryStatus = createStore<DirectoryStatus>(IDLE);
  const find = createStore<FindState>(EMPTY_FIND);
  const savedFolders = createStore<ReadonlyMap<string, string>>(new Map());

  async function refreshDirectory(): Promise<void> {
    directoryStatus.set((s) => (s.refreshing ? s : { ...s, refreshing: true }));
    try {
      await directory.refresh();
      directoryStatus.set({ refreshing: false, error: null, lastAttempt: now() });
    } catch (err) {
      directoryStatus.set({ refreshing: false, error: sentenceOf(err), lastAttempt: now() });
    }
  }

  return {
    backend,
    directory,
    tracker,
    directoryStatus,
    server,
    refreshServer,
    posts,
    assignments,
    team,
    spotChecks,
    refusedPosts,
    highlights,
    find,
    savedFolders,
    outbox,
    refreshDirectory,

    async startDirectory() {
      directoryStatus.set((s) => (s.refreshing ? s : { ...s, refreshing: true }));
      // Yesterday's list from disk is on screen at once; the refresh below
      // shares the one request when there is no disk copy to show.
      void directory.list().catch(() => undefined);
      if (!server.get().known) void refreshServer();
      await refreshDirectory();
    },

    async openProperty(id, viewer) {
      return forViewer(await directory.detail(id), viewer);
    },

    async reword(text) {
      const firebase = getFirebase();
      if (!firebase) throw new UserFacingError('Rewording needs you signed in with your account.');
      let reply: { readonly text?: unknown };
      try {
        reply = await firebase.call<{ readonly text?: unknown }>('paraphrase', { text });
      } catch (err) {
        throw new UserFacingError(rewordFailure(err), err);
      }
      if (typeof reply.text !== 'string' || !reply.text.trim()) {
        throw new UserFacingError("Claude's reword came back empty. Try again, or post the original.");
      }
      return reply.text;
    },

    forget() {
      directory.clear();
      posts.reset();
      assignments.reset();
      team.reset();
      spotChecks.reset();
      refusedPosts.reset();
      highlights.reset();
      directoryStatus.set(IDLE);
      server.set(UNKNOWN_SERVER);
      find.set(EMPTY_FIND);
      savedFolders.set(new Map());
    },
  };
}

function sameRules(a: ServerRules | null, b: ServerRules | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.cooldownDays === b.cooldownDays &&
    a.repostDueDays === b.repostDueDays &&
    a.perWeek === b.perWeek &&
    a.perIntern === b.perIntern
  );
}

function sameServer(a: ServerState, b: ServerState): boolean {
  return a.known === b.known && a.version === b.version && a.versionStatus === b.versionStatus && sameRules(a.rules, b.rules);
}

/**
 * A listing as `viewer` may see it. For an intern, guards on top of the
 * server's own (D1, D13), so a reply that wrongly carried more never reaches
 * a screen:
 *
 * - the internal section of a separated document is kept, to read behind a
 *   toggle (D1, since v9); Copy never takes it. Any other internal text is
 *   dropped;
 * - a document nobody has separated keeps none of its text, since none of it
 *   is confirmed safe. `hasInternal: false` is how a screen knows to explain
 *   that rather than show an empty box. The one exception is a v7 server's
 *   `unseparated: true`: the owner's decision to show it, to be checked, with
 *   its risky lines flagged (D15). Without that flag (an older server, or a
 *   reply that also says `withheld`), it is withheld as before.
 */
export function forViewer(detail: PropertyDetail, viewer: User): PropertyDetail {
  if (canManage(viewer)) return detail;
  const { internalText: _never, ...publicOnly } = detail;
  if (detail.hasInternal) return detail;
  if (detail.unseparated === true && detail.withheld !== true) return publicOnly;
  return { ...publicOnly, publicText: '' };
}

/**
 * The sentence for a reword that didn't come back. The function's refusals (a
 * limit reached, Claude switched off) are written to be shown as they are.
 * Firebase's own failures on the way there say only their code ("internal").
 */
function rewordFailure(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { readonly code?: unknown }).code : undefined;
  // Firebase's SDK ends each message with the HTTP status: "Claude is busy. … [503]".
  const raw = err instanceof Error ? err.message.trim() : '';
  const status = /\[(\d+)\]$/.exec(raw)?.[1];
  // No answer the app could read: offline, or turned away before the function ran.
  if (status === '0') return "Couldn't reach Claude. Try again, or post the original.";
  const message = raw.replace(/\s*\[\d+\]$/, '');
  const fromFunction =
    typeof code === 'string' && code.startsWith('functions/') && message !== '' && message.toLowerCase() !== code.slice('functions/'.length);
  return fromFunction ? message : "Claude didn't answer. Try again, or post the original.";
}
