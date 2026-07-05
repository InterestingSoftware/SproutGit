import { Info } from 'lucide-react';
import { api } from '../api.js';
import { useState, useEffect } from 'react';
import type { GitInfo } from '@sproutgit/types';
import { Spinner } from '@sproutgit/ui';
import { useUpdateStore } from '../stores/update-store.js';

export function AppSection() {
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [releaseNotesLoading, setReleaseNotesLoading] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const { updateState, setUpdateState } = useUpdateStore();

  useEffect(() => {
    void api.appVersion().then((v: string) => setAppVersion(v)).catch(() => setAppVersion('unknown'));
    void api.gitInfo().then(setGitInfo).catch(() => setGitInfo({ installed: false, version: 'Unavailable' }));
  }, []);

  useEffect(() => {
    const offChecking = api.onUpdateChecking(() => { setUpdateState({ status: 'checking' }); setCheckingForUpdates(true); setUpdateError(null); });
    const offAvailable = api.onUpdateAvailable((version: string) => {
      setUpdateState({ status: 'available', version });
      setCheckingForUpdates(false);
    });
    const offNotAvailable = api.onUpdateNotAvailable(() => { setUpdateState({ status: 'up-to-date' }); setCheckingForUpdates(false); });
    const offDownloading = api.onUpdateDownloading((progress: number) => setUpdateState({ status: 'downloading', progress }));
    const offReady = api.onUpdateReady(() => setUpdateState({ status: 'ready' }));
    const offError = api.onUpdateError((message: string) => {
      console.error('[update] auto-update failed:', message);
      setUpdateError(message);
      setUpdateState({ status: 'idle' });
      setCheckingForUpdates(false);
    });
    return () => { offChecking(); offAvailable(); offNotAvailable(); offDownloading(); offReady(); offError(); };
  }, [setUpdateState]);

  useEffect(() => {
    if (updateState.status !== 'available') { setReleaseNotes(null); return; }
    const targetVersion = (updateState as { status: 'available'; version: string }).version;
    const currentVersion = appVersion ?? '0.0.0';
    setReleaseNotesLoading(true);
    fetch('https://api.github.com/repos/InterestingSoftware/SproutGit/releases?per_page=100', {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(r => r.json())
      .then((raw: unknown) => {
        if (!Array.isArray(raw)) { setReleaseNotes(null); return; }
        function stripV(v: string) { return v.trim().replace(/^v/i, ''); }
        function semver(v: string): [number, number, number] | null {
          const parts = stripV(v).split('-')[0]?.split('.') ?? [];
          if (parts.length !== 3) return null;
          const n = parts.map(Number);
          return n.every(Number.isFinite) ? [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0] : null;
        }
        function cmp(a: [number, number, number], b: [number, number, number]) {
          return a[0] !== b[0] ? a[0] - b[0] : a[1] !== b[1] ? a[1] - b[1] : a[2] - b[2];
        }
        const cur = semver(currentVersion);
        const tgt = semver(targetVersion);
        if (!cur || !tgt) { setReleaseNotes(null); return; }
        const sections: string[] = [];
        for (const item of raw) {
          if (!item || typeof item !== 'object') continue;
          const r = item as { tag_name?: string; name?: string | null; body?: string | null; draft?: boolean };
          if (r.draft) continue;
          const tag = typeof r.tag_name === 'string' ? r.tag_name : null;
          if (!tag) continue;
          const ver = semver(tag);
          if (!ver) continue;
          if (cmp(ver, cur) <= 0 || cmp(ver, tgt) > 0) continue;
          const header = r.name?.trim() ? `v${stripV(tag)} – ${r.name.trim()}` : `v${stripV(tag)}`;
          const body = typeof r.body === 'string' ? r.body.trim() : '';
          sections.push(`${header}\n${body || 'No release notes provided.'}`);
        }
        setReleaseNotes(sections.length > 0 ? sections.join('\n\n') : null);
      })
      .catch(() => setReleaseNotes(null))
      .finally(() => setReleaseNotesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateState.status]);

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface) p-5">
      <h2 className="sg-heading mb-3 text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
        <Info size={15} /> About
      </h2>
      <div className="space-y-1.5 text-xs text-(--sg-text-dim)">
        <div className="flex justify-between">
          <span>SproutGit version</span>
          <span className="font-mono">{import.meta.env.DEV ? 'dev build' : (appVersion ?? '…')}</span>
        </div>
        <div className="flex justify-between">
          <span>Git</span>
          <span className="font-mono">
            {gitInfo ? (gitInfo.installed ? gitInfo.version : 'Not found') : '…'}
          </span>
        </div>
      </div>

      {!import.meta.env.DEV && <div className="mt-4 pt-4 border-t border-(--sg-border) flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs ${updateState.status === 'idle' && updateError ? 'text-(--sg-danger)' : 'text-(--sg-text-dim)'}`}>
            {updateState.status === 'up-to-date' && 'SproutGit is up to date.'}
            {updateState.status === 'checking' && 'Checking for updates…'}
            {updateState.status === 'available' && `Update ${(updateState as { status: 'available'; version: string }).version} is available`}
            {updateState.status === 'downloading' && `Downloading… ${Math.round((updateState as { status: 'downloading'; progress: number }).progress)}%`}
            {updateState.status === 'ready' && 'Update downloaded and ready to install.'}
            {updateState.status === 'idle' && (updateError ? `Update failed: ${updateError}` : 'Check for the latest version.')}
          </span>
          <div className="flex gap-2 shrink-0">
            {updateState.status === 'ready' ? (
              <button
                className="inline-flex items-center gap-1 px-3 py-[5px] rounded-[6px] text-xs font-medium bg-(--sg-primary) text-white cursor-pointer border-none hover:bg-(--sg-primary-hover)"
                onClick={() => void api.installUpdate()}
              >
                Install &amp; Restart
              </button>
            ) : (
              <button
                className="inline-flex items-center gap-1 px-3 py-[5px] rounded-[6px] text-xs font-medium bg-transparent border border-(--sg-border) text-(--sg-text-dim) cursor-pointer hover:bg-(--sg-surface-raised) disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => { setCheckingForUpdates(true); void api.checkForUpdates(); }}
                disabled={checkingForUpdates || updateState.status === 'checking' || updateState.status === 'downloading'}
              >
                {checkingForUpdates ? <Spinner size="sm" /> : null}
                Check for Updates
              </button>
            )}
          </div>
        </div>

        {updateState.status === 'available' && (
          <div className="flex flex-col gap-2">
            {releaseNotesLoading && (
              <div className="flex items-center gap-2 text-[11px] text-(--sg-text-faint)">
                <Spinner size="sm" /> Loading release notes…
              </div>
            )}
            {releaseNotes && (
              <pre className="text-[11px] text-(--sg-text-dim) whitespace-pre-wrap font-(family-name:--sg-font-code) bg-(--sg-input-bg) border border-(--sg-border) rounded-[6px] p-3 max-h-[200px] overflow-y-auto m-0">
                {releaseNotes}
              </pre>
            )}
          </div>
        )}
      </div>}
    </section>
  );
}
