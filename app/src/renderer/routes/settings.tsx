import { Settings as SettingsIcon } from 'lucide-react';
import { api } from '../api.js';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState, useContext } from 'react';
import type { GitHubAuthStatus } from '@sproutgit/types';
import { WindowControls, UpdateBadge } from '@sproutgit/ui';
import { rootRoute } from './__root.js';
import { ToastContext } from '../toast-context.js';
import { useUpdateStore } from '../stores/update-store.js';
import { GitHubSection } from '../settings/GitHubSection.js';
import { GitSection } from '../settings/GitSection.js';
import { ShellSection } from '../settings/ShellSection.js';
import { AppSection } from '../settings/AppSection.js';
import { CommitMessageGeneratorSection } from '../settings/CommitMessageGeneratorSection.js';

// ── Route definition ──────────────────────────────────────────────────────────

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    workspace: typeof search['workspace'] === 'string' ? search['workspace'] : '',
  }),
});

// ── Settings page ─────────────────────────────────────────────────────────────

function SettingsPage() {
  const navigate = useNavigate();
  const toast = useContext(ToastContext);
  const { workspace: workspacePath } = settingsRoute.useSearch();
  const { updateState } = useUpdateStore();

  const [githubAuth, setGithubAuth] = useState<GitHubAuthStatus | null>(null);

  function goBack() {
    if (workspacePath) {
      void navigate({ to: '/workspace', search: { path: workspacePath } });
    } else {
      void navigate({ to: '/' });
    }
  }

  return (
    <main className="sg-body flex h-screen flex-col" data-testid="settings-page">
      {/* Titlebar */}
      <header
        data-electron-drag-region
        className="flex h-(--sg-titlebar-height) shrink-0 items-center gap-3 border-b border-(--sg-border) bg-(--sg-surface) pl-(--sg-titlebar-inset)"
      >
        <button
          onClick={goBack}
          className="group flex items-center gap-1 rounded-md px-2 py-1 text-xs text-(--sg-text-dim) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text)"
        >
          <span className="transition-transform group-hover:-translate-x-0.5">←</span>
          <span>{workspacePath ? workspacePath.split(/[\\/]/).filter(Boolean).pop() : 'Projects'}</span>
        </button>
        <div className="h-3 w-px bg-(--sg-border)" />
        <span className="sg-heading text-xs font-medium text-(--sg-text)">Settings</span>
        <div className="ml-auto flex h-full items-center gap-2">
          <UpdateBadge state={updateState} onInstall={() => void api.installUpdate()} />
        </div>
        <WindowControls side="right" />
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">

          {/* Page header */}
          <div className="relative flex items-center gap-3 rounded-lg bg-gradient-to-r from-(--sg-primary)/8 via-(--sg-primary)/4 to-transparent px-4 py-3">
            <span aria-hidden className="absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full bg-(--sg-primary)" />
            <div className="rounded-lg bg-(--sg-primary)/15 p-2 text-(--sg-primary) shrink-0">
              <SettingsIcon size={18} />
            </div>
            <div>
              <h1 className="sg-heading text-lg font-semibold text-(--sg-primary)">Settings</h1>
              <p className="text-[11px] text-(--sg-text-faint)">Configure SproutGit, integrations, and your default tools.</p>
            </div>
          </div>

          <GitHubSection onToast={toast} onAuthChange={setGithubAuth} />

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <div className="flex flex-col gap-6">
              <GitSection onToast={toast} githubAuth={githubAuth} />
              <CommitMessageGeneratorSection onToast={toast} />
            </div>

            <div className="flex flex-col gap-6">
              <ShellSection onToast={toast} />
              <AppSection />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
