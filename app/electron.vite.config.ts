import { resolve } from 'path';
import { cpSync } from 'fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Workspace packages are ESM-only; exclude them from externalization so Vite
// bundles them into the CJS main/preload output instead of require()-ing them.
const WORKSPACE_PACKAGES = [
  '@sproutgit/types',
  '@sproutgit/database',
  '@sproutgit/git',
  '@sproutgit/terminal',
  '@sproutgit/provider-github',
];

/**
 * Stub plugin: replaces `better-sqlite3` with an empty class in the bundled
 * Electron main/preload output. The app uses `node:sqlite` (built into
 * Electron 32+ / Node 22.5+) via our compat layer, so the native
 * better-sqlite3 binary is never needed at runtime.
 * drizzle-orm/better-sqlite3 still imports the package at the top level for
 * types; this stub satisfies that import without loading any native code.
 */
function betterSqlite3Stub() {
  const VIRTUAL_ID = '\0better-sqlite3-stub';
  return {
    name: 'better-sqlite3-stub',
    enforce: 'pre' as const,
    resolveId(id: string) {
      if (id === 'better-sqlite3') return VIRTUAL_ID;
      return null;
    },
    load(id: string) {
      if (id === VIRTUAL_ID) {
        return `class Database {} module.exports = Database;`;
      }
      return null;
    },
  };
}

/**
 * Copies drizzle migration folders to out/migrations/ after the main bundle is
 * written.  The bundled config-db / workspace-db resolve migrations relative to
 * __filename → out/main/../migrations/config (= out/migrations/config).
 */
function copyMigrationsPlugin() {
  return {
    name: 'copy-migrations',
    closeBundle() {
      const src = resolve(__dirname, '..', 'packages', 'database', 'migrations');
      const dest = resolve(__dirname, 'out', 'migrations');
      cpSync(src, dest, { recursive: true });
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES }), betterSqlite3Stub(), copyMigrationsPlugin()],
    // Baked in at build time from the CI env — lets a future signing setup
    // turn mac auto-update back on (see app/src/main/ipc/update.ts) by
    // setting this env var before `electron-vite build`, with no app source
    // changes required.
    define: {
      __SPROUTGIT_MAC_AUTO_UPDATE_ENABLED__: JSON.stringify(process.env['SPROUTGIT_MAC_AUTO_UPDATE_ENABLED'] === 'true'),
    },
    build: {
      watch: {
        // Also watch workspace package sources so changes there trigger a
        // main-process rebuild + Electron restart during `pnpm dev`.
        include: ['src/main/**', '../packages/*/src/**'],
      },
      rollupOptions: {
        // 'electron' is provided by the runtime; native modules cannot be bundled.
        external: ['electron', 'node-pty'],
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: {
      rollupOptions: {
        external: ['electron', 'node-pty'],
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [
      react({}),
      tailwindcss(),
    ],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
