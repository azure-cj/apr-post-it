import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Links Apps Script files into the app as ES modules, so logic that must agree
 * between the server and the app exists exactly once (DECISIONS.md D13).
 *
 * A .gs file is plain JavaScript of top-level function declarations. This
 * appends a named export for each, at build time: nothing is run from a
 * string, so the Content Security Policy that forbids eval still holds. The
 * module is strict, which Apps Script is not, so a .gs edit that relies on
 * sloppy mode fails the tests here rather than passing on the server.
 */
function linkAppsScript(): Plugin {
  return {
    name: 'link-apps-script',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.gs')) return null;
      const names = [...code.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
      if (names.length === 0) this.error(`${id} declares no top-level functions to export`);
      return { code: `${code}\nexport { ${names.join(', ')} };\n`, map: null };
    },
  };
}

// Tauri serves the built files. `npm run dev` runs the app in a browser against
// the real web app (src/platform/browser.ts); the tests use the fake platform.
export default defineConfig({
  plugins: [linkAppsScript(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@server': fileURLToPath(new URL('./server', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust's build output changes constantly and Windows locks files in it while
    // compiling; watching it crashes the dev server (EBUSY). Vite needs none of it.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2022', sourcemap: false },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // A link built in through .env.local or src/config.ts is for the app, not
    // the tests: the setup file makes it empty everywhere, and only a test that
    // wants a built-in link mocks '@/config' with one.
    env: { VITE_SCRIPT_URL: '' },
    setupFiles: ['src/testSetup.ts'],
  },
});
