import { useSyncExternalStore } from 'react';

/**
 * A value that changes, held outside React so that only the screens reading it
 * re-render when it does. Read it with `useStore`.
 */
export interface Store<T> {
  get(): T;
  /** Replaces the value, or derives it from the current one. Listeners hear only real changes. */
  set(next: T | ((current: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The store's value, re-rendering when it changes. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
