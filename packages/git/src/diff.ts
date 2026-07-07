import { type DiffFilesResult, type DiffContentResult, type DiffFileEntry } from '@sproutgit/types';
import { gitForPath } from './client.js';

/**
 * Lists the files changed in a commit (or between two commits).
 */
export async function getDiffFiles(
  repoPath: string,
  commit: string,
  base?: string | null
): Promise<DiffFilesResult> {
  const git = gitForPath(repoPath);
  const range = base ? [base, commit] : [`${commit}^`, commit];

  const raw = await git.raw(['diff', '--name-status', '--diff-filter=ACDMRT', ...range]);

  const files: DiffFileEntry[] = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [status = '', ...rest] = line.split('\t');
      // Renames produce two paths: old\tnew
      const oldPath = rest.length > 1 ? (rest[0] ?? null) : null;
      const path = rest.at(-1) ?? '';
      return { path, status: status[0] ?? status, oldPath };
    });

  return { commit, base: base ?? null, files };
}

/**
 * Returns the raw unified diff for a specific file (or all files if `filePath`
 * is omitted) in a commit.
 */
export async function getDiffContent(
  repoPath: string,
  commit: string,
  base?: string | null,
  filePath?: string | null
): Promise<DiffContentResult> {
  const git = gitForPath(repoPath);
  const range = base ? [base, commit] : [`${commit}^`, commit];

  const args = ['diff', '--unified=3', ...range];
  if (filePath) {
    args.push('--', filePath);
  }

  const diff = await git.raw(args);

  return { commit, base: base ?? null, filePath: filePath ?? null, diff };
}

/**
 * Returns the raw unified diff of currently staged changes (index vs HEAD).
 * Used as the input fed to commit-message generators.
 */
export async function getStagedDiff(worktreePath: string): Promise<string> {
  const git = gitForPath(worktreePath);
  return git.raw(['diff', '--cached', '--unified=3']);
}

/**
 * Returns the unified diff for the current working tree (staged + unstaged).
 */
export async function getWorkingDiff(
  worktreePath: string,
  filePath?: string | null
): Promise<DiffContentResult> {
  const git = gitForPath(worktreePath);

  const args = ['diff', '--unified=3', 'HEAD'];
  if (filePath) {
    args.push('--', filePath);
  }

  const diff = await git.raw(args);

  return { commit: 'WORKING', base: 'HEAD', filePath: filePath ?? null, diff };
}
