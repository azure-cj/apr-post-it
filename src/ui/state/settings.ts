import { BUILT_IN_SCRIPT_URL } from '@/config';
import { defaultSettings } from '@/core/types';

/**
 * What this PC remembers between launches, apart from the key. The key is not
 * here, and never in the WebView's storage: the OS holds it (platform.readKey),
 * and the backend reads it from there before every call.
 */
export interface AppSettings {
  /**
   * The web app's /exec link. The one built into this version when there is
   * one (src/config.ts); otherwise whatever was typed at sign-in.
   */
  readonly scriptUrl: string;
  /** Days before a listing may be posted again. The server enforces its own; this one is for display. */
  readonly cooldownDays: number;
  /** Days without a post after which a listing is due for a repost. */
  readonly repostDueDays: number;
}

/** Where the settings are kept, through platform.readLocal / writeLocal. */
export const SETTINGS_KEY = 'postit.settings';

export const defaultAppSettings: AppSettings = Object.freeze({
  scriptUrl: defaultSettings.scriptUrl,
  cooldownDays: defaultSettings.cooldownDays,
  repostDueDays: defaultSettings.repostDueDays,
});

/**
 * The settings with the link built into this version, when there is one. A
 * link kept by an older install, or typed by hand, never overrides it: the
 * built-in link is the one this build was made for.
 */
export function withBuiltInLink(settings: AppSettings): AppSettings {
  const builtIn = BUILT_IN_SCRIPT_URL;
  return builtIn && settings.scriptUrl !== builtIn ? { ...settings, scriptUrl: builtIn } : settings;
}

/**
 * Reads what was stored. Anything missing, damaged or out of range falls back
 * to the default, and a built-in link replaces whatever link was kept.
 */
export function parseSettings(text: string | null | undefined): AppSettings {
  let saved: Record<string, unknown> = {};
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) saved = value as Record<string, unknown>;
  } catch {
    // A damaged file is no settings: the defaults, and sign in again.
  }
  return withBuiltInLink({
    scriptUrl: typeof saved['scriptUrl'] === 'string' ? saved['scriptUrl'].trim() : defaultAppSettings.scriptUrl,
    cooldownDays: wholeDays(saved['cooldownDays'], defaultAppSettings.cooldownDays),
    repostDueDays: wholeDays(saved['repostDueDays'], defaultAppSettings.repostDueDays),
  });
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify({
    scriptUrl: settings.scriptUrl,
    cooldownDays: settings.cooldownDays,
    repostDueDays: settings.repostDueDays,
  });
}

function wholeDays(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365 ? value : fallback;
}
