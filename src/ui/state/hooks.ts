import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ReportedPost } from '@/core/refused';
import type { SpotCheck } from '@/core/spotchecks';
import type { Assignment, PostLogEntry, Property, TeamMember, User } from '@/core/types';
import { useApp } from './AppState';
import type { Remote, RemoteResource } from './remote';
import type { DirectoryStatus, FindState } from './services';
import { useStore } from './store';

/** Who is signed in. Only for screens behind the sign-in guard: anywhere else it throws. */
export function useUser(): User {
  const { user } = useApp();
  if (!user) throw new Error('useUser() is for screens shown only when someone is signed in.');
  return user;
}

/** Every property, sorted by name; null until the first list arrives. Re-renders when the list changes. */
export function useDirectoryList(): readonly Property[] | null {
  const { directory } = useApp();
  return useSyncExternalStore(directory.subscribe, directory.peek, directory.peek);
}

export function useDirectoryStatus(): DirectoryStatus {
  return useStore(useApp().directoryStatus);
}

export interface RemoteView<T> extends Remote<T> {
  /** Reads again now. Never rejects: a failure lands in `error`. */
  reload(): void;
}

export interface RemoteOptions {
  /** On arrival, use what was read less than this long ago (ms). Default 30 s. */
  readonly maxAgeMs?: number;
  /** While the screen is up, read again this often (ms), and when the window gets the focus back. */
  readonly pollMs?: number;
}

function useRemote<T>(resource: RemoteResource<T>, { maxAgeMs = 30_000, pollMs }: RemoteOptions): RemoteView<T> {
  const state = useStore(resource.store);

  useEffect(() => {
    void resource.refresh(maxAgeMs);
    if (!pollMs) return undefined;
    const timer = setInterval(() => void resource.refresh(), pollMs);
    // Back from Facebook: what changed meanwhile, unless it was just read.
    const onFocus = () => void resource.refresh(Math.min(maxAgeMs, 15_000));
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [resource, maxAgeMs, pollMs]);

  const reload = useCallback(() => void resource.refresh(), [resource]);
  return { ...state, reload };
}

/** The Posts rows you may see: your own as an intern, everyone's as a manager. Read on arrival. */
export function usePosts(options: RemoteOptions = {}): RemoteView<readonly PostLogEntry[]> {
  return useRemote(useApp().posts, options);
}

/** The Assignments rows you may see: your own queue as an intern. Read on arrival. */
export function useAssignments(options: RemoteOptions = {}): RemoteView<readonly Assignment[]> {
  return useRemote(useApp().assignments, options);
}

/** The Spot checks tab (Admin only, v16). Read on arrival. */
export function useSpotChecks(options: RemoteOptions = {}): RemoteView<readonly SpotCheck[]> {
  return useRemote(useApp().spotChecks, options);
}

/** The Refused posts tab (Admin only, v18). Read on arrival. */
export function useRefusedPosts(options: RemoteOptions = {}): RemoteView<readonly ReportedPost[]> {
  return useRemote(useApp().refusedPosts, options);
}

/** The Team tab without its keys. Admin only: the server refuses anyone else. Read on arrival. */
export function useTeam(options: RemoteOptions = {}): RemoteView<readonly TeamMember[]> {
  return useRemote(useApp().team, options);
}

/** The Find screen's search and filters, kept while you open a listing and come back. */
export function useFindState(): readonly [FindState, (changes: Partial<FindState>) => void] {
  const { find } = useApp();
  const state = useStore(find);
  const update = useCallback((changes: Partial<FindState>) => find.set((s) => ({ ...s, ...changes })), [find]);
  return [state, update] as const;
}

/** Where this listing's photos were saved this session, or null. */
export function useSavedFolder(propertyId: string): readonly [string | null, (folder: string) => void] {
  const { savedFolders } = useApp();
  const folders = useStore(savedFolders);
  const remember = useCallback(
    (folder: string) => savedFolders.set((all) => new Map(all).set(propertyId, folder)),
    [savedFolders, propertyId],
  );
  return [folders.get(propertyId) ?? null, remember] as const;
}
