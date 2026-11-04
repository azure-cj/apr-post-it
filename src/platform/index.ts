/**
 * The only way from the screens and the rules to the OS.
 *
 * Three versions: Tauri's (tauri.ts), the desktop app; a plain browser's
 * (browser.ts), for development against the real web app; and a fake
 * (fake.ts), which is how the screens are tested — no Windows, no WebView,
 * no Rust.
 */

import type { FirebaseAccess } from './firebase';

/** A newer version, signed with the app's key, ready to download. */
export interface AppUpdate {
  readonly version: string;
  /** What changed, as the release says it. Blank when it says nothing. */
  readonly notes: string;
  /**
   * Downloads and installs it, then restarts the app. `progress` gets 0 to 1,
   * or null while the size isn't known. Resolves only if the app didn't close.
   */
  install(progress: (share: number | null) => void): Promise<void>;
}

export interface SavedPhoto {
  readonly name: string;
  readonly path: string;
}

export interface Platform {
  /** Put text on the clipboard. The one button that matters. */
  copyText(text: string): Promise<void>;

  /**
   * Put one photo on the clipboard, as an image to paste into Facebook. Call it
   * straight from the click: the clipboard takes the photo while it downloads.
   */
  copyPhoto(url: string): Promise<void>;

  /** POST JSON to the Apps Script web app, through Rust so cross-site limits don't apply. */
  post(url: string, body: unknown): Promise<unknown>;

  /** Download every photo to Downloads\APG Post-It\<property>. Returns where they went. */
  savePhotos(property: string, photos: readonly { name: string; url: string }[]): Promise<readonly SavedPhoto[]>;

  /** Open a folder in Explorer, or a link in the browser. */
  open(target: string): Promise<void>;

  /** Per-viewer values that may be lost without harm: the last signed-in name, a filter. */
  readLocal(key: string): Promise<string | null>;
  writeLocal(key: string, value: string): Promise<void>;

  /** The key is kept by the OS, never in the WebView. */
  readKey(): Promise<string | null>;
  writeKey(key: string): Promise<void>;

  /**
   * The shared Firebase server: the live project in the installed app, the
   * emulator on this PC in development, and null where there is none. Made on
   * first use, once per window.
   */
  firebase(): Promise<FirebaseAccess | null>;

  /**
   * A newer version of the app from the releases repo, or null when this is
   * the newest or there is nowhere to update from (the browser, development).
   * Rejects only when the check itself failed.
   */
  checkUpdate(): Promise<AppUpdate | null>;

  /** True on a machine where saving photos and Explorer work. */
  readonly hasFileSystem: boolean;

  // ---- the window ---------------------------------------------------------
  // The desktop window has no frame of its own (decorations: false), so the
  // app draws minimize, maximize and close. In a browser there is no window
  // to control: `hasWindowControls` is false and these do nothing.

  /** True where the app draws the window's controls. */
  readonly hasWindowControls: boolean;
  minimize(): Promise<void>;
  /** Maximize, or restore if it already is. */
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** Calls `handler` when the window is maximized or restored, however that happened. Returns a stop function. */
  onMaximizedChange(handler: (maximized: boolean) => void): () => void;
  /**
   * Asks to close, the way Alt+F4 and the taskbar do, so it reaches
   * `onCloseRequested` like they do.
   */
  requestClose(): Promise<void>;
  /**
   * Holds every request to close (the close button, Alt+F4, the taskbar) and
   * calls `handler` instead. The window then closes only through `destroy()`.
   * Returns a stop function.
   */
  onCloseRequested(handler: () => void): () => void;
  /** Closes the window now, without asking again. */
  destroy(): Promise<void>;
}

let current: Platform | null = null;

export function setPlatform(p: Platform): void {
  current = p;
}

export function platform(): Platform {
  if (!current) throw new Error('No platform set. Call setPlatform() at start-up.');
  return current;
}
