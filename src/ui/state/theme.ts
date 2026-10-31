/**
 * Dark or light, and who chose it.
 *
 *   const { choice, resolved, setChoice } = useTheme();
 *   setChoice('system');      // follows Windows' "Choose your mode", live
 *
 * The choice is kept with platform().writeLocal('theme') and shown as
 * `<html data-theme="dark|light">`; tokens.css does the rest, so no
 * component knows which theme it is in. main.tsx calls applySavedTheme()
 * before the first render, so the first frame is already in the right theme.
 *
 * Dark is the default: a missing, damaged or unknown value is dark.
 */

import { useSyncExternalStore } from 'react';
import { platform, type Platform } from '@/platform';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

/** Where the choice is kept, through platform().readLocal / writeLocal. */
export const THEME_KEY = 'theme';
export const DEFAULT_THEME: ThemeChoice = 'dark';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

export function parseThemeChoice(value: string | null | undefined): ThemeChoice {
  return value === 'light' || value === 'system' || value === 'dark' ? value : DEFAULT_THEME;
}

/** 'system' becomes whatever the OS asks for; with no answer, dark. */
export function resolveTheme(choice: ThemeChoice, systemPrefersLight: boolean): ResolvedTheme {
  if (choice === 'system') return systemPrefersLight ? 'light' : 'dark';
  return choice;
}

// ---- the one store ---------------------------------------------------------

interface ThemeState {
  readonly choice: ThemeChoice;
  readonly resolved: ResolvedTheme;
}

let choice: ThemeChoice = DEFAULT_THEME;
let snapshot: ThemeState = { choice, resolved: 'dark' };
const listeners = new Set<() => void>();
let media: MediaQueryList | null = null;

function lightQuery(): MediaQueryList | null {
  if (media) return media;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  media = window.matchMedia(LIGHT_QUERY);
  // Windows' mode changes while the app is open: only 'system' follows it.
  const onChange = (): void => {
    if (choice === 'system') update(choice);
  };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
  else media.addListener?.(onChange);
  return media;
}

function update(next: ThemeChoice): void {
  choice = next;
  const resolved = resolveTheme(next, lightQuery()?.matches ?? false);
  if (typeof document !== 'undefined') document.documentElement.dataset['theme'] = resolved;
  if (snapshot.choice !== next || snapshot.resolved !== resolved) {
    snapshot = { choice: next, resolved };
    listeners.forEach((listener) => listener());
  }
}

/**
 * Reads the kept choice and applies it. Call once, before the first render.
 * A choice that cannot be read is dark, and never stops the app starting.
 */
export async function applySavedTheme(from: Platform = platform()): Promise<ThemeChoice> {
  let saved: string | null = null;
  try {
    saved = await from.readLocal(THEME_KEY);
  } catch {
    // Unreadable is the default.
  }
  update(parseThemeChoice(saved));
  return choice;
}

/** Applies a choice now and keeps it. Losing it to a failed write is harmless: it is dark next time. */
export function setThemeChoice(next: ThemeChoice): void {
  update(next);
  try {
    void platform()
      .writeLocal(THEME_KEY, next)
      .catch(() => undefined);
  } catch {
    // No platform yet: applied, not kept.
  }
}

function subscribe(listener: () => void): () => void {
  lightQuery();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): ThemeState => snapshot;

export interface UseTheme extends ThemeState {
  setChoice(next: ThemeChoice): void;
}

export function useTheme(): UseTheme {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { choice: state.choice, resolved: state.resolved, setChoice: setThemeChoice };
}
