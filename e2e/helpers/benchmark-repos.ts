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

export const HERO_SNAPSHOT_TAG = 'benchmark-v1';

export function createHeroMediaRepo() {
  const repoPath = createTestRepo('hero-media', {
    files: {
      'src/app.ts': 'export const appName = "SproutGit";\n',
      'src/lib/context.ts': 'export const context = { repo: true };\n',
      'docs/shot-list.md': '# Canonical shots\n',
      'tests/smoke/worktree.spec.ts': 'export {};\n',
    },
    extraCommits: 1,
  });

  checkout(repoPath, 'feature/graph-polish', true);
  writeRepoFile(repoPath, 'src/lib/graph.ts', 'export const graphMode = "hero";\n');
  writeRepoFile(repoPath, 'src/lib/colors.ts', 'export const laneColors = ["green", "gold"];\n');
  commitAll(repoPath, 'Add graph polish assets', 10);

  checkout(repoPath, 'main');
  checkout(repoPath, 'feature/diff-panel', true);
  writeRepoFile(repoPath, 'src/lib/diff.ts', 'export const diffMode = "split";\n');
  writeRepoFile(repoPath, 'src/lib/components/DiffFixture.txt', 'line 1\nline 2\nline 3\n');
  commitAll(repoPath, 'Add diff panel fixture', 11);

  checkout(repoPath, 'main');
  checkout(repoPath, 'feature/context-menu', true);
  writeRepoFile(repoPath, 'src/lib/context-menu.ts', 'export const contextMenu = ["copy", "checkout"];\n');
  commitAll(repoPath, 'Add context menu actions', 12);

  checkout(repoPath, 'main');
  mergeNoFastForward(repoPath, 'feature/graph-polish', 'Merge graph polish', 20);
  mergeNoFastForward(repoPath, 'feature/diff-panel', 'Merge diff panel', 21);
  createAnnotatedTag(repoPath, HERO_SNAPSHOT_TAG, 'Pinned hero benchmark snapshot', 22);
  runGit(repoPath, ['branch', 'release/benchmark-ui']);

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
    writeRepoFile(repoPath, `fixtures/scale/file-${String(index).padStart(3, '0')}.txt`, `row ${index}\n`);
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

export function materializeCanaryRepo(definition: { name: string; remoteUrl: string; ref: string | null }) {
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