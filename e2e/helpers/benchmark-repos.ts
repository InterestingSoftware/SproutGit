import { join } from 'node:path';

import {
  CANARIES_DIR,
  checkout,
  cloneCanaryRepo,
  commitAll,
  createAnnotatedTag,
  createTestRepo,
  mergeNoFastForward,
  runGit,
  writeRepoFile,
} from './fixtures';

export const HERO_SNAPSHOT_TAG = 'v1.0.0';

export function createHeroMediaRepo() {
  const repoPath = createTestRepo('axiom', {
    files: {
      'src/index.ts': 'export { createApp } from "./app";\n',
      'src/app.ts': 'export function createApp() { return { version: "0.1.0" }; }\n',
      'src/auth/index.ts': 'export { authenticate } from "./jwt";\n',
      'src/auth/jwt.ts': 'export function authenticate(token: string) { return !!token; }\n',
      'src/api/client.ts': 'export const BASE_URL = "https://api.axiom.dev";\n',
      'src/ui/dashboard.tsx': 'export function Dashboard() { return <div>Dashboard</div>; }\n',
      'src/ui/components/Button.tsx':
        'export function Button({ label }: { label: string }) { return <button>{label}</button>; }\n',
      'src/utils/helpers.ts': 'export const noop = () => {};\n',
      'src/config.ts': 'export const config = { env: "development", debug: true };\n',
      'docs/README.md': '# Axiom\n\nA modern TypeScript application framework.\n',
      'docs/api.md': '# API Reference\n\nSee source for details.\n',
      'tests/smoke.test.ts': 'describe("smoke", () => { it("works", () => {}); });\n',
      '.github/workflows/ci.yml':
        'name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n',
    },
    extraCommits: 1,
  });

  // ── feature/auth ────────────────────────────────────────────────────────────
  checkout(repoPath, 'feature/auth', true);
  writeRepoFile(
    repoPath,
    'src/auth/jwt.ts',
    'export function authenticate(token: string) {\n' +
      '  if (!token) throw new Error("Missing token");\n' +
      '  return { valid: true, sub: "user:1" };\n' +
      '}\n'
  );
  commitAll(repoPath, 'feat(auth): add JWT validation with error handling', 2);
  writeRepoFile(
    repoPath,
    'src/auth/refresh.ts',
    'export function refreshToken(token: string) { return token; }\n'
  );
  commitAll(repoPath, 'feat(auth): add refresh token support', 3);
  writeRepoFile(
    repoPath,
    'tests/auth.test.ts',
    'describe("auth", () => { it("validates JWT", () => {}); });\n'
  );
  commitAll(repoPath, 'test(auth): add JWT unit tests', 4);
  checkout(repoPath, 'main');
  mergeNoFastForward(repoPath, 'feature/auth', 'Merge feature/auth: JWT validation', 20);

  // ── feature/dashboard ───────────────────────────────────────────────────────
  checkout(repoPath, 'feature/dashboard', true);
  writeRepoFile(
    repoPath,
    'src/ui/dashboard.tsx',
    'export function Dashboard() {\n' +
      '  return (\n' +
      '    <div className="dashboard">\n' +
      '      <h1>Dashboard</h1>\n' +
      '      <MetricsPanel />\n' +
      '    </div>\n' +
      '  );\n' +
      '}\n'
  );
  commitAll(repoPath, 'feat(ui): redesign dashboard with metrics panel', 5);
  writeRepoFile(
    repoPath,
    'src/ui/components/MetricsPanel.tsx',
    'export function MetricsPanel() { return <div className="metrics" />; }\n'
  );
  commitAll(repoPath, 'feat(ui): add MetricsPanel component', 6);
  writeRepoFile(
    repoPath,
    'src/ui/theme.ts',
    'export const theme = { primary: "#1a8a5c", surface: "#fff" };\n'
  );
  commitAll(repoPath, 'feat(ui): add design token configuration', 7);
  writeRepoFile(
    repoPath,
    'tests/dashboard.test.tsx',
    'describe("Dashboard", () => { it("renders", () => {}); });\n'
  );
  commitAll(repoPath, 'test(ui): add dashboard snapshot tests', 8);
  checkout(repoPath, 'main');
  mergeNoFastForward(repoPath, 'feature/dashboard', 'Merge feature/dashboard: redesign', 21);

  // ── hotfix/token-expiry ─────────────────────────────────────────────────────
  checkout(repoPath, 'hotfix/token-expiry', true);
  writeRepoFile(
    repoPath,
    'src/auth/jwt.ts',
    'export function authenticate(token: string) {\n' +
      '  if (!token) throw new Error("Missing token");\n' +
      '  if (isExpired(token)) throw new Error("Token expired");\n' +
      '  return { valid: true, sub: "user:1" };\n' +
      '}\n' +
      'export function isExpired(_token: string) { return false; }\n'
  );
  commitAll(repoPath, 'fix: handle expired JWT tokens gracefully', 9);
  writeRepoFile(
    repoPath,
    'tests/auth.test.ts',
    'describe("auth", () => {\n' +
      '  it("validates JWT", () => {});\n' +
      '  it("rejects expired tokens", () => {});\n' +
      '});\n'
  );
  commitAll(repoPath, 'test: add token expiry regression test', 10);
  checkout(repoPath, 'main');
  mergeNoFastForward(
    repoPath,
    'hotfix/token-expiry',
    'Merge hotfix/token-expiry: expired JWT patch',
    22
  );

  // ── release/1.0 tag ─────────────────────────────────────────────────────────
  checkout(repoPath, 'release/1.0', true);
  writeRepoFile(
    repoPath,
    'src/index.ts',
    'export { createApp } from "./app";\nexport const VERSION = "1.0.0";\n'
  );
  commitAll(repoPath, 'chore: bump version to 1.0.0', 33);
  createAnnotatedTag(repoPath, HERO_SNAPSHOT_TAG, 'Release 1.0.0 — stable auth and dashboard', 34);
  checkout(repoPath, 'main');

  // ── feature/notifications ───────────────────────────────────────────────────
  checkout(repoPath, 'feature/notifications', true);
  writeRepoFile(
    repoPath,
    'src/notifications/index.ts',
    'export function notify(msg: string) { console.log(msg); }\n'
  );
  commitAll(repoPath, 'feat: add push notification service', 14);
  writeRepoFile(
    repoPath,
    'src/notifications/preferences.ts',
    'export const defaultPrefs = { email: true, push: true };\n'
  );
  commitAll(repoPath, 'feat: add notification preference model', 15);
  writeRepoFile(
    repoPath,
    'tests/notifications.test.ts',
    'describe("notifications", () => { it("sends", () => {}); });\n'
  );
  commitAll(repoPath, 'test: add notification unit tests', 16);
  checkout(repoPath, 'main');
  mergeNoFastForward(repoPath, 'feature/notifications', 'Merge feature/notifications', 23);

  // ── chore/deps ──────────────────────────────────────────────────────────────
  checkout(repoPath, 'chore/deps', true);
  writeRepoFile(repoPath, 'package.json', '{ "name": "axiom", "version": "1.1.0-next" }\n');
  commitAll(repoPath, 'chore(deps): upgrade TypeScript to 5.4', 17);
  writeRepoFile(
    repoPath,
    'vite.config.ts',
    'import { defineConfig } from "vite";\nexport default defineConfig({});\n'
  );
  commitAll(repoPath, 'chore(deps): upgrade Vite to 5.3', 18);
  checkout(repoPath, 'main');
  mergeNoFastForward(repoPath, 'chore/deps', 'Merge chore/deps: dependency upgrades', 24);

  // ── post-merge main commits ──────────────────────────────────────────────────
  writeRepoFile(
    repoPath,
    'docs/CHANGELOG.md',
    '# Changelog\n\n## v1.1.0\n- Push notifications\n- Dependency upgrades\n'
  );
  commitAll(repoPath, 'docs: update CHANGELOG for v1.1.0', 35);
  writeRepoFile(
    repoPath,
    'src/config.ts',
    'export const config = { env: "production", debug: false };\n'
  );
  commitAll(repoPath, 'chore: switch default env to production', 36);
  createAnnotatedTag(repoPath, 'v1.1.0', 'Release 1.1.0 — notifications and dep upgrades', 37);

  // ── Open feature branches (not merged) ──────────────────────────────────────

  checkout(repoPath, 'feature/api-v2', true);
  writeRepoFile(
    repoPath,
    'src/api/v2/client.ts',
    'export const API_V2 = "https://api.axiom.dev/v2";\n'
  );
  commitAll(repoPath, 'feat(api): scaffold v2 client module', 11);
  writeRepoFile(
    repoPath,
    'src/api/v2/schema.ts',
    'export type ApiResponse<T> = { data: T; meta: object };\n'
  );
  commitAll(repoPath, 'feat(api): add v2 response schema types', 12);
  writeRepoFile(
    repoPath,
    'src/api/v2/batch.ts',
    'export function batch(requests: unknown[]) { return requests; }\n'
  );
  commitAll(repoPath, 'feat(api): add request batching support', 13);
  checkout(repoPath, 'main');

  checkout(repoPath, 'feature/dark-mode', true);
  writeRepoFile(
    repoPath,
    'src/ui/theme.ts',
    'export const theme = { primary: "#1a8a5c", surface: "#fff" };\n' +
      'export const darkTheme = { primary: "#74c7a4", surface: "#1e1e2e" };\n'
  );
  commitAll(repoPath, 'feat: implement system-level dark mode', 19);
  writeRepoFile(
    repoPath,
    'src/ui/useTheme.ts',
    'export function useTheme() {\n  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";\n}\n'
  );
  commitAll(repoPath, 'feat: add useTheme hook for automatic dark mode', 26);
  writeRepoFile(
    repoPath,
    'tests/theme.test.ts',
    'describe("theme", () => { it("detects dark mode", () => {}); });\n'
  );
  commitAll(repoPath, 'test: add dark mode detection unit tests', 27);
  checkout(repoPath, 'main');

  checkout(repoPath, 'feat/settings', true);
  writeRepoFile(
    repoPath,
    'src/ui/settings/index.tsx',
    'export function SettingsPage() { return <div>Settings</div>; }\n'
  );
  commitAll(repoPath, 'feat: add user settings page skeleton', 28);
  writeRepoFile(
    repoPath,
    'src/ui/settings/storage.ts',
    'export const saveSettings = (s: object) => localStorage.setItem("settings", JSON.stringify(s));\n'
  );
  commitAll(repoPath, 'feat: persist settings to localStorage', 29);
  writeRepoFile(
    repoPath,
    'tests/settings.test.ts',
    'describe("settings", () => { it("persists", () => {}); });\n'
  );
  commitAll(repoPath, 'test: add settings integration tests', 30);
  checkout(repoPath, 'main');

  checkout(repoPath, 'docs/api-reference', true);
  writeRepoFile(
    repoPath,
    'docs/api.md',
    '# API Reference\n\n## createApp()\n\nCreates an Axiom application instance.\n\n```ts\nimport { createApp } from "axiom";\nconst app = createApp();\n```\n'
  );
  commitAll(repoPath, 'docs: write comprehensive API reference guide', 31);
  writeRepoFile(
    repoPath,
    'docs/examples/quickstart.ts',
    'import { createApp } from "axiom";\nconst app = createApp();\napp.listen(3000);\n'
  );
  commitAll(repoPath, 'docs: add quickstart code examples', 32);
  checkout(repoPath, 'main');

  return repoPath;
}

export function createGraphStressRepo() {
  const repoPath = createTestRepo('stress-graph', { extraCommits: 2 });

  for (const [offset, branch] of ['feature/a', 'feature/b', 'feature/c'].entries()) {
    checkout(repoPath, branch, true);
    writeRepoFile(repoPath, `${branch.replace('/', '-')}.txt`, `${branch}\n`);
    commitAll(repoPath, `Advance ${branch}`, 30 + offset);
    checkout(repoPath, 'main');
  }

  mergeNoFastForward(repoPath, 'feature/a', 'Merge feature/a', 40);
  mergeNoFastForward(repoPath, 'feature/b', 'Merge feature/b', 41);
  mergeNoFastForward(repoPath, 'feature/c', 'Merge feature/c', 42);
  createAnnotatedTag(repoPath, 'stress-graph-v1', 'Graph stress snapshot', 43);

  return repoPath;
}

export function createNamingEdgeCaseRepo() {
  return createTestRepo('stress-naming', {
    branches: [
      'feature/with-dashes',
      'feature/with_underscores',
      'release/2026-q2',
      'bugfix/context.menu',
    ],
    files: {
      'src/names.txt': 'edge cases\n',
    },
  });
}

export function createScaleStressRepo() {
  const repoPath = createTestRepo('stress-scale');
  for (let index = 0; index < 120; index += 1) {
    writeRepoFile(
      repoPath,
      `fixtures/scale/file-${String(index).padStart(3, '0')}.txt`,
      `row ${index}\n`
    );
  }
  commitAll(repoPath, 'Add scale fixture set', 50);
  return repoPath;
}

export const CANARY_REPOS = [
  {
    name: 'pnpm',
    remoteUrl: 'https://github.com/pnpm/pnpm.git',
    ref: process.env.CANARY_REF_PNPM || null,
  },
  {
    name: 'svelte-kit',
    remoteUrl: 'https://github.com/sveltejs/kit.git',
    ref: process.env.CANARY_REF_SVELTE_KIT || null,
  },
];

export function materializeCanaryRepo(definition: {
  name: string;
  remoteUrl: string;
  ref: string | null;
}) {
  return cloneCanaryRepo(join(CANARIES_DIR, definition.name), definition.remoteUrl, definition.ref);
}

export function createAllGeneratedBenchmarks() {
  return {
    hero: createHeroMediaRepo(),
    graph: createGraphStressRepo(),
    naming: createNamingEdgeCaseRepo(),
    scale: createScaleStressRepo(),
  };
}
