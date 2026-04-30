import type { Update } from '@tauri-apps/plugin-updater';

let available = $state<Update | null>(null);
let checked = $state(false);

type GitHubRelease = {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
};

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const RELEASES_API_URL =
  'https://api.github.com/repos/InterestingSoftware/SproutGit/releases?per_page=100';

function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function parseSemver(version: string): ParsedSemver | null {
  const cleaned = stripVersionPrefix(version).split('+')[0] ?? '';
  const [core, prereleasePart] = cleaned.split('-', 2);
  const parts = (core ?? '').split('.');
  if (parts.length !== 3) return null;

  const major = Number.parseInt(parts[0] ?? '', 10);
  const minor = Number.parseInt(parts[1] ?? '', 10);
  const patch = Number.parseInt(parts[2] ?? '', 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease: (prereleasePart ?? '').split('.').filter(Boolean),
  };
}

function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  const aPre = a.prerelease;
  const bPre = b.prerelease;

  // Stable versions sort after pre-release versions with the same core.
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const maxLen = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < maxLen; i += 1) {
    const left = aPre[i];
    const right = bPre[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNum = Number.parseInt(left, 10);
    const rightNum = Number.parseInt(right, 10);
    const leftIsNum = /^\d+$/.test(left);
    const rightIsNum = /^\d+$/.test(right);

    if (leftIsNum && rightIsNum) return leftNum - rightNum;
    if (leftIsNum) return -1;
    if (rightIsNum) return 1;
    return left.localeCompare(right);
  }

  return 0;
}

function sectionHeader(release: GitHubRelease, version: string): string {
  const title = release.name?.trim();
  return title ? `v${version} - ${title}` : `v${version}`;
}

export async function loadReleaseNotesBetween(
  currentVersion: string,
  targetVersion: string
): Promise<string | null> {
  const currentParsed = parseSemver(currentVersion);
  const targetParsed = parseSemver(targetVersion);
  if (!currentParsed || !targetParsed) return null;
  if (compareSemver(targetParsed, currentParsed) <= 0) return null;

  const response = await fetch(RELEASES_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release fetch failed (${response.status})`);
  }

  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw)) return null;

  const sections: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const release = item as GitHubRelease;
    if (release.draft) continue;

    const tag = typeof release.tag_name === 'string' ? release.tag_name : null;
    if (!tag) continue;

    const version = stripVersionPrefix(tag);
    const parsedVersion = parseSemver(version);
    if (!parsedVersion) continue;

    const afterCurrent = compareSemver(parsedVersion, currentParsed) > 0;
    const atOrBeforeTarget = compareSemver(parsedVersion, targetParsed) <= 0;
    if (!afterCurrent || !atOrBeforeTarget) continue;

    const body = typeof release.body === 'string' ? release.body.trim() : '';
    const header = sectionHeader(release, version);
    sections.push(`${header}\n${body || 'No release notes provided.'}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}

export const updateState = {
  get available() {
    return available;
  },
  get checked() {
    return checked;
  },
  set(update: Update | null) {
    available = update;
    checked = true;
  },
};
