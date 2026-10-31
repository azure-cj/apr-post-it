import { createBackend, type Backend } from '@/core/backend';
import { createDirectory, type Directory } from '@/core/directory';
import { createTracker, type Tracker } from '@/core/tracker';
import { canManage, type Assignment, type PostLogEntry, type PropertyDetail, type TeamMember, type User } from '@/core/types';
import type { Platform } from '@/platform';
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

/** What the Find screen was showing, kept while you open a listing and come back. */
export interface FindState {
  readonly query: string;
  /** A category facet's key, or '' for every category. */
  readonly category: string;
  /** A listing-type facet's key, or '' for every listing type. */
  readonly listingType: string;
}

export const EMPTY_FIND: FindState = Object.freeze({ query: '', category: '', listingType: '' });
const IDLE: DirectoryStatus = Object.freeze({ refreshing: false, error: null, lastAttempt: null });

/** Everything the screens use that is not React: built once per window. */
export interface Services {
  readonly backend: Backend;
  readonly directory: Directory;
  /** The tracker. Every write marks the posts and queues held below as stale. */
  readonly tracker: Tracker;
  readonly directoryStatus: Store<DirectoryStatus>;
  /** The Posts rows you may see: an intern's own, everyone's for a manager. Shared for a few seconds. */
  readonly posts: RemoteResource<readonly PostLogEntry[]>;
  /** The Assignments rows you may see. Shared for a few seconds. */
  readonly assignments: RemoteResource<readonly Assignment[]>;
  /** The Team tab (Admin only): names, roles, FB accounts, active. Never keys. */
  readonly team: RemoteResource<readonly TeamMember[]>;
  readonly find: Store<FindState>;
  /** Where each listing's photos were saved this session, by property id: for Open folder. */
  readonly savedFolders: Store<ReadonlyMap<string, string>>;
  /** Fetches the property list now and records how it went. Never rejects. */
  refreshDirectory(): Promise<void>;
  /** On sign-in: the list from disk at once when there is one, then a fresh one. Never rejects. */
  startDirectory(): Promise<void>;
  /** A listing as this person may see it: see `forViewer`. */
  openProperty(id: string, viewer: User): Promise<PropertyDetail>;
  /** Forgets everything held for the person signing out. The key is the caller's to remove. */
  forget(): void;
}

export function createServices(p: Platform, getSettings: () => AppSettings, now: () => number): Services {
  // The link and key are read before every call, so a link changed in
  // Settings applies at once and the key never lives in React state.
  const backend = createBackend({
    post: p.post,
    getConfig: async () => ({ url: getSettings().scriptUrl, key: await p.readKey() }),
  });
  const directory = createDirectory({ backend, store: p, now });
  const raw = createTracker({ backend });

  const posts = createRemote(() => raw.posts(), now);
  const assignments = createRemote(() => raw.assignments(), now);
  const team = createRemote(() => raw.team(), now);

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
    saveQueue: (date, assignedTo, items) => writing(() => raw.saveQueue(date, assignedTo, items)),
    setStatus: (item, status) => writing(() => raw.setStatus(item, status)),
    saveQueues: (date, queues) => writing(() => raw.saveQueues(date, queues)),
    addPerson: (input) => teamWrite(() => raw.addPerson(input)),
    setActive: (name, active) => teamWrite(() => raw.setActive(name, active)),
    updatePerson: (name, changes) => teamWrite(() => raw.updatePerson(name, changes)),
    newKey: (name) => teamWrite(() => raw.newKey(name)),
    indexCheck: () => raw.indexCheck(),
  };

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
    posts,
    assignments,
    team,
    find,
    savedFolders,
    refreshDirectory,

    async startDirectory() {
      directoryStatus.set((s) => (s.refreshing ? s : { ...s, refreshing: true }));
      // Yesterday's list from disk is on screen at once; the refresh below
      // shares the one request when there is no disk copy to show.
      void directory.list().catch(() => undefined);
      await refreshDirectory();
    },

    async openProperty(id, viewer) {
      return forViewer(await directory.detail(id), viewer);
    },

    forget() {
      directory.clear();
      posts.reset();
      assignments.reset();
      team.reset();
      directoryStatus.set(IDLE);
      find.set(EMPTY_FIND);
      savedFolders.set(new Map());
    },
  };
}

/**
 * A listing as `viewer` may see it. For an intern, two guards on top of the
 * server's own (D1, D13), so a reply that wrongly carried more never reaches
 * a screen:
 *
 * - the internal section is dropped, not hidden: it is not in the object;
 * - a document nobody has separated keeps none of its text, since none of it
 *   is confirmed safe. `hasInternal: false` is how a screen knows to explain
 *   that rather than show an empty box.
 */
export function forViewer(detail: PropertyDetail, viewer: User): PropertyDetail {
  if (canManage(viewer)) return detail;
  const { internalText: _never, ...publicOnly } = detail;
  return detail.hasInternal ? publicOnly : { ...publicOnly, publicText: '' };
}
