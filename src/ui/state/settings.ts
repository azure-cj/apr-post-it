import { BUILT_IN_SCRIPT_URL } from '@/config';
import { defaultSettings, RULE_LIMITS, type ServerRules } from '@/core/types';

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
  /**
   * Days before a listing may be posted again. The server's rule, from ping
   * (withServerRules), once signed in; until then the last one kept here, or
   * the default. The server enforces its own.
   */
  readonly cooldownDays: number;
  /** Days without a post after which a listing is due for a repost. The server's rule, as cooldownDays. */
  readonly repostDueDays: number;
  /** The planner's default items per intern. The server's rule, as cooldownDays. */
  readonly perIntern: number;
}

/** Where the settings are kept, through platform.readLocal / writeLocal. */
export const SETTINGS_KEY = 'postit.settings';

export const defaultAppSettings: AppSettings = Object.freeze({
  scriptUrl: defaultSettings.scriptUrl,
  cooldownDays: defaultSettings.cooldownDays,
  repostDueDays: defaultSettings.repostDueDays,
  perIntern: defaultSettings.perIntern,
});

/**
 * The settings with the server's rules in place of the ones kept here: the
 * rules are the admin's, set on the server (setRules) and sent with every
 * ping. Null (a server that sends none) leaves the settings as they are. The
 * same object back when nothing changes.
 */
export function withServerRules(settings: AppSettings, rules: ServerRules | null | undefined): AppSettings {
  if (!rules) return settings;
  if (
    settings.cooldownDays === rules.cooldownDays &&
    settings.repostDueDays === rules.repostDueDays &&
    settings.perIntern === rules.perIntern
  ) {
    return settings;
  }
  return { ...settings, cooldownDays: rules.cooldownDays, repostDueDays: rules.repostDueDays, perIntern: rules.perIntern };
}

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
    perIntern: inRange(saved['perIntern'], RULE_LIMITS.perIntern, defaultAppSettings.perIntern),
  });
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify({
    scriptUrl: settings.scriptUrl,
    cooldownDays: settings.cooldownDays,
    repostDueDays: settings.repostDueDays,
    perIntern: settings.perIntern,
  });
}

function inRange(value: unknown, limits: { readonly min: number; readonly max: number }, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= limits.min && value <= limits.max
    ? value
    : fallback;
}

function wholeDays(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365 ? value : fallback;
}
