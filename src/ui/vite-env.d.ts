/// <reference types="vite/client" />
// Vite's client types: import.meta.env (the UI kit route is development-only)
// and CSS/asset imports.

interface ImportMetaEnv {
  /** The web app's /exec link to build in (src/config.ts). Optional. */
  readonly VITE_SCRIPT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
