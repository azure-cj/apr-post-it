/**
 * The only way from the screens and the rules to the OS.
 *
 * Two versions: Tauri's, and a fake. With the fake the whole app runs in a
 * plain browser, which is how the screens are built and how they are tested —
 * no Windows, no WebView, no Rust.
 */

export interface SavedPhoto {
  readonly name: string;
  readonly path: string;
}

export interface Platform {
  /** Put text on the clipboard. The one button that matters. */
  copyText(text: string): Promise<void>;

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

  /** True on a machine where saving photos and Explorer work. */
  readonly hasFileSystem: boolean;
}

let current: Platform | null = null;

export function setPlatform(p: Platform): void {
  current = p;
}

export function platform(): Platform {
  if (!current) throw new Error('No platform set. Call setPlatform() at start-up.');
  return current;
}
