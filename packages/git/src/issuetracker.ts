import { simpleGit } from 'simple-git';
import type { IssueTrackerPattern } from '@sproutgit/types';

/**
 * Reads the `.issuetracker` file at the root of `worktreePath`, if present.
 *
 * The file uses gitconfig/INI syntax (the convention established by the Fork
 * git client and others), e.g.:
 *
 *   [issuetracker "Jira"]
 *       regex = "ABCD-(\\d+)"
 *       url = "https://my-company.atlassian.net/browse/ABCD-$1"
 *
 * `git config -f <path> --get-regexp` resolves the path relative to
 * `baseDir` and returns one line per key, e.g.
 * `issuetracker.Jira.regex ABCD-(\d+)`. Grouped by label into patterns.
 */
export async function readIssueTrackerFile(worktreePath: string): Promise<IssueTrackerPattern[]> {
  const git = simpleGit({ baseDir: worktreePath });
  let raw: string;
  try {
    raw = await git.raw(['config', '-f', '.issuetracker', '--get-regexp', '^issuetracker\\.']);
  } catch {
    // Missing file or no matching keys — git exits non-zero either way.
    return [];
  }

  const byLabel = new Map<string, { regex?: string; url?: string }>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;
    const key = line.slice(0, spaceIdx);
    const value = line.slice(spaceIdx + 1);

    const match = /^issuetracker\.(.+)\.(regex|url)$/.exec(key);
    if (!match) continue;
    const [, label, field] = match;
    if (!label || !field) continue;

    const entry = byLabel.get(label) ?? {};
    entry[field as 'regex' | 'url'] = value;
    byLabel.set(label, entry);
  }

  const patterns: IssueTrackerPattern[] = [];
  for (const [label, entry] of byLabel) {
    if (entry.regex && entry.url) {
      patterns.push({ label, regex: entry.regex, url: entry.url });
    }
  }
  return patterns;
}
