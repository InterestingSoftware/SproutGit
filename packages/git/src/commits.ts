import {
  type CommitGraphResult,
  type CommitEntry,
  type RefsResult,
  type RefInfo,
} from '@sproutgit/types';
import { gitForPath } from './client.js';

/** Log format that encodes all fields needed for the commit graph. */
const GRAPH_FORMAT = '%H\x1f%h\x1f%P\x1f%an\x1f%ae\x1f%aI\x1f%s\x1f%D';
const FIELD_SEP = '\x1f';

/**
 * Returns commits for the graph view. Fetches `limit` entries starting at
 * `skip` (for pagination). Defaults to 500 / 0.
 */
export async function getCommitGraph(
  repoPath: string,
  limit = 500,
  skip = 0
): Promise<CommitGraphResult> {
  const git = gitForPath(repoPath);

  const args = [
    'log',
    '--all',
    '--topo-order',
    `--format=${GRAPH_FORMAT}`,
    `--max-count=${limit}`,
    `--skip=${skip}`,
  ];

  const raw = await git.raw(args);
  const commits = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(parseCommitLine);

  return { repoPath, commits };
}

/**
 * Returns the total commit count across all refs (used for pagination hints).
 */
export async function countCommits(repoPath: string): Promise<number> {
  const git = gitForPath(repoPath);
  const raw = await git.raw(['rev-list', '--all', '--count']);
  return parseInt(raw.trim(), 10);
}

/**
 * Lists all local branches, remote-tracking branches, and tags.
 */
export async function listRefs(repoPath: string): Promise<RefsResult> {
  const git = gitForPath(repoPath);

  // format: <refname> <objectname> <symref> (symref may be empty)
  const raw = await git.raw([
    'for-each-ref',
    '--format=%(refname)\x1f%(objectname:short)\x1f%(symref)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]);

  const refs: RefInfo[] = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(parseRefLine);

  // Discover the default remote branch (e.g. origin/main) by reading HEAD on the remote.
  let defaultRemoteBranch: string | undefined;
  try {
    const headRef = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    // Transforms "refs/remotes/origin/main" → "origin/main"
    defaultRemoteBranch = headRef.trim().replace('refs/remotes/', '');
  } catch {
    // Not all repos have this set — safe to ignore.
  }

  return { repoPath, refs, defaultRemoteBranch };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseCommitLine(line: string): CommitEntry {
  const parts = line.split(FIELD_SEP);
  const hash = parts[0] ?? '';
  const shortHash = parts[1] ?? '';
  const parents = (parts[2] ?? '').split(' ').filter(Boolean);
  const authorName = parts[3] ?? '';
  const authorEmail = parts[4] ?? '';
  const authorDate = parts[5] ?? '';
  const subject = parts[6] ?? '';
  const decorations = parts[7] ?? '';

  const refs = decorations
    .split(', ')
    .map(r => r.trim())
    .filter(Boolean);

  return { hash, shortHash, parents, authorName, authorEmail, authorDate, subject, refs };
}

function parseRefLine(line: string): RefInfo {
  const [fullName = '', target = ''] = line.split(FIELD_SEP);
  let kind: RefInfo['kind'];
  let name: string;

  if (fullName.startsWith('refs/heads/')) {
    kind = 'branch';
    name = fullName.replace('refs/heads/', '');
  } else if (fullName.startsWith('refs/remotes/')) {
    kind = 'remote';
    name = fullName.replace('refs/remotes/', '');
  } else {
    kind = 'tag';
    name = fullName.replace('refs/tags/', '');
  }

  return { fullName, name, kind, target };
}
