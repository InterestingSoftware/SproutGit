import { api } from '../api.js';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { useState, useEffect, useRef } from 'react';
import { AppWindow, ArrowRight, Clock, Download, FolderInput, FolderOpen, HelpCircle, Play, Settings, Sparkles, X, AlertTriangle } from 'lucide-react';
import { Spinner, WindowControls, UpdateBadge, Autocomplete, ResizableSidebar } from '@sproutgit/ui';
import type { UpdateState } from '@sproutgit/ui';
import type { Driver } from 'driver.js';
import type { AgentConfig, GitHubRepo, GitInfo, GitHubAuthStatus, GitOpProgressEvent, RecentWorkspace } from '@sproutgit/types';
import { useToast } from '../toast-context.js';
import { reportError } from '../error-reporting.js';
import { setPendingScaffold } from '../pending-scaffold.js';
import { startHomeTour, HOME_TOUR_SETTING_KEY } from '../onboarding/homeTour.js';
import logoSvgUrl from '../logo.svg?inline';

// Shared Tailwind class strings
const primaryBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] cursor-pointer text-xs font-medium transition-colors whitespace-nowrap border-none bg-(--sg-primary) text-white hover:bg-(--sg-primary-hover) disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-transparent border border-(--sg-border) text-(--sg-text-dim) hover:bg-(--sg-surface-raised) disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryBtnSm = 'inline-flex items-center gap-[5px] px-2 py-1 rounded-[6px] cursor-pointer text-[11px] font-medium transition-colors whitespace-nowrap bg-transparent border border-(--sg-border) text-(--sg-text-dim) hover:bg-(--sg-surface-raised) disabled:opacity-50 disabled:cursor-not-allowed';
const iconBtn = 'inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised) disabled:opacity-40 disabled:cursor-not-allowed';
const actionBtn = 'group flex items-center gap-[10px] w-full px-[10px] py-2 rounded-lg bg-transparent border border-transparent text-[13px] font-medium text-(--sg-text) cursor-pointer text-left transition-[background,border-color] hover:bg-[color-mix(in_srgb,var(--sg-primary)_8%,transparent)] hover:border-[color-mix(in_srgb,var(--sg-primary)_30%,transparent)] disabled:opacity-40 disabled:cursor-not-allowed';
const actionIcon = 'flex items-center justify-center w-7 h-7 rounded-[7px] shrink-0 bg-[color-mix(in_srgb,var(--sg-primary)_12%,transparent)] text-(--sg-primary) transition-[background] group-hover:bg-[color-mix(in_srgb,var(--sg-primary)_20%,transparent)]';
const fieldInput = 'w-full px-[10px] py-[6px] bg-(--sg-input-bg) border border-(--sg-input-border) rounded-[6px] text-xs text-(--sg-text) outline-none focus:border-(--sg-input-focus)';
const fieldLabel = 'text-[11px] font-semibold text-(--sg-text-dim) uppercase tracking-[0.04em]';
const sectionHeader = 'flex items-center gap-[6px] px-[14px] py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-(--sg-text-dim) border-b border-(--sg-border-subtle)';


function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const sep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf(':'));
  return sep === -1 ? '' : trimmed.slice(sep + 1);
}

function repoNameFromPath(p: string): string {
  const trimmed = p.trim().replace(/[\\/]+$/g, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function workspaceDisplayName(workspacePath: string): string {
  return repoNameFromPath(workspacePath) || workspacePath.trim() || '?';
}

/** The kickoff message auto-sent to the agent right after a "New from idea" project is created — see pending-scaffold.ts. */
function buildScaffoldPrompt(args: { name: string; pitch: string; techStack: string; description: string }): string {
  return `Set up the initial boilerplate for a brand new project called "${args.name}".

Idea: ${args.pitch}

Tech stack: ${args.techStack}
Description: ${args.description}

Create a sensible initial folder structure, a README describing the project, a .gitignore appropriate for the stack, and any baseline config/dependency files the stack needs. Make an initial commit once the boilerplate is in place.`;
}

function formatRelativeDate(d: Date | string | number): string {
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

const PROJECTS_FOLDER_SETTING = 'projectsFolder';

function HomeView() {
  const navigate = useNavigate();
  const toast = useToast();

  const [recents, setRecents] = useState<RecentWorkspace[]>([]);
  const [opening, setOpening] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [projectsFolder, setProjectsFolder] = useState('');
  const [gitChecked, setGitChecked] = useState(false);
  const [gitNotInstalled, setGitNotInstalled] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });

  // First-run walkthrough — see onboarding/homeTour.ts
  const [recentsLoaded, setRecentsLoaded] = useState(false);
  const [tourSeen, setTourSeen] = useState<boolean | null>(null);
  const tourRef = useRef<Driver | null>(null);

  // GitHub repos for clone autocomplete
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);

  // Clone modal
  const [showClone, setShowClone] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneFolderName, setCloneFolderName] = useState('');
  const [cloneFolderManual, setCloneFolderManual] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<string[]>([]);
  const [clonePhase, setClonePhase] = useState('');
  const [cloneError, setCloneError] = useState('');
  const cloneUrlRef = useRef<HTMLInputElement>(null);
  const progressEndRef = useRef<HTMLDivElement>(null);

  // Import modal
  const [showImport, setShowImport] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importMode, setImportMode] = useState<'inPlace' | 'move' | 'copy'>('inPlace');
  const [importFolderName, setImportFolderName] = useState('');
  const [importFolderManual, setImportFolderManual] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgressMsg, setImportProgressMsg] = useState('');
  const [importError, setImportError] = useState('');
  const importPathRef = useRef<HTMLInputElement>(null);

  // Idea modal (new project from a pitch) — only offered once an AI agent is configured
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [showIdea, setShowIdea] = useState(false);
  const [ideaPitch, setIdeaPitch] = useState('');
  const [ideaGenerating, setIdeaGenerating] = useState(false);
  const [ideaGenerated, setIdeaGenerated] = useState(false);
  const [ideaName, setIdeaName] = useState('');
  const [ideaTechStack, setIdeaTechStack] = useState('');
  const [ideaDescription, setIdeaDescription] = useState('');
  const [ideaError, setIdeaError] = useState('');
  const [ideaCreating, setIdeaCreating] = useState(false);
  const ideaPitchRef = useRef<HTMLTextAreaElement>(null);

  function resetIdeaState() {
    setIdeaPitch(''); setIdeaGenerated(false); setIdeaName(''); setIdeaTechStack(''); setIdeaDescription('');
    setIdeaError('');
  }

  useEffect(() => {
    void api.appVersion()
      .then(v => setAppVersion(import.meta.env.DEV ? 'dev build' : `v${v}`))
      .catch(() => undefined);

    void api.gitInfo().then((info: GitInfo) => {
      if (!info.installed) setGitNotInstalled(true);
      setGitChecked(true);
    }).catch(() => { setGitChecked(true); });

    void api.listRecentWorkspaces().then((ws: RecentWorkspace[]) => {
      const sorted = [...ws].sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime());
      setRecents(sorted);
    }).catch(() => undefined).finally(() => setRecentsLoaded(true));

    void api.getSetting(HOME_TOUR_SETTING_KEY)
      .then(v => setTourSeen(!!v))
      .catch(() => setTourSeen(true)); // fail closed — don't nag if we can't tell

    void api.getSetting(PROJECTS_FOLDER_SETTING).then(async (v: string | null) => {
      if (v) {
        setProjectsFolder(v);
      } else {
        try {
          const home = await api.getHomeDir();
          const defaultFolder = `${home}/Projects`;
          setProjectsFolder(defaultFolder);
        } catch {
          // ignore
        }
      }
    }).catch(() => undefined);

    void api.githubAuthStatus().then(async (status: GitHubAuthStatus) => {
      if (status.authenticated) {
        try {
          const repos = await api.githubListRepos();
          setGithubRepos(repos);
        } catch {
          // not critical
        }
      }
    }).catch(() => undefined);

    void api.getAgentConfig().then(setAgentConfig).catch(() => undefined);
  }, []);

  useEffect(() => { if (showClone) setTimeout(() => cloneUrlRef.current?.focus(), 50); }, [showClone]);
  useEffect(() => { if (showImport) setTimeout(() => importPathRef.current?.focus(), 50); }, [showImport]);
  useEffect(() => { if (showIdea) setTimeout(() => ideaPitchRef.current?.focus(), 50); }, [showIdea]);

  useEffect(() => {
    const offChecking = api.onUpdateChecking(() => setUpdateState({ status: 'checking' }));
    const offAvailable = api.onUpdateAvailable((version: string) => setUpdateState({ status: 'available', version }));
    const offNotAvailable = api.onUpdateNotAvailable(() => setUpdateState({ status: 'up-to-date' }));
    const offDownloading = api.onUpdateDownloading((progress: number) => setUpdateState({ status: 'downloading', progress }));
    const offReady = api.onUpdateReady(() => setUpdateState({ status: 'ready' }));
    const offError = api.onUpdateError((message: string) => {
      reportError('Update failed', message);
      setUpdateState({ status: 'idle' });
    });
    return () => { offChecking(); offAvailable(); offNotAvailable(); offDownloading(); offReady(); offError(); };
  }, []);

  // Auto-launch the first-run walkthrough once we know there's nothing to
  // interrupt: git is present, recents have loaded (so we're not showing it
  // to a returning user for the split second before their list appears),
  // and it hasn't been seen before. Skipped entirely in E2E — WebdriverIO
  // reuses one long-lived session across every spec file, and several specs
  // click home-screen buttons directly; an unrelated auto-tour stealing that
  // first click would make the whole suite's outcome depend on spec order.
  // The manual "Replay walkthrough" button still works in E2E for dedicated
  // coverage of the tour itself.
  useEffect(() => {
    if (api.isE2E) return;
    if (!gitChecked || gitNotInstalled) return;
    if (!recentsLoaded || tourSeen !== false) return;
    if (recents.length > 0) return;
    tourRef.current?.destroy();
    tourRef.current = startHomeTour(() => {
      setTourSeen(true);
      void api.setSetting(HOME_TOUR_SETTING_KEY, '1').catch(() => undefined);
    });
  }, [gitChecked, gitNotInstalled, recentsLoaded, tourSeen, recents.length]);

  // Unconditional, mount-once cleanup: driver.js appends the popover/overlay
  // straight to document.body, outside React's tree — if the user clicks
  // through to a workspace without ever dismissing the tour (the highlighted
  // step's own action buttons stay clickable), it would otherwise survive
  // the route change. Deliberately its own effect, not the guarded one
  // above — that effect's cleanup only fires on its OWN re-run, and once
  // tourSeen flips true it re-runs into an early return with no cleanup,
  // silently dropping the destroy call this needs to guarantee on unmount.
  useEffect(() => () => tourRef.current?.destroy(), []);

  function replayTour() {
    tourRef.current?.destroy();
    tourRef.current = startHomeTour(() => {
      setTourSeen(true);
      void api.setSetting(HOME_TOUR_SETTING_KEY, '1').catch(() => undefined);
    });
  }

  useEffect(() => {
    if (!cloneFolderManual) setCloneFolderName(repoNameFromUrl(cloneUrl));
  }, [cloneUrl, cloneFolderManual]);

  useEffect(() => {
    if (!importFolderManual) setImportFolderName(repoNameFromPath(importPath));
  }, [importPath, importFolderManual]);


  useEffect(() => {
    progressEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cloneProgress]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showImport) { e.preventDefault(); setShowImport(false); }
        else if (showClone) { e.preventDefault(); setShowClone(false); }
        else if (showIdea) { e.preventDefault(); setShowIdea(false); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showClone, showImport, showIdea]);

  async function openWorkspace(workspacePath: string, fromRecents = false) {
    setOpening(true);
    try {
      if (fromRecents) {
        const status = await api.inspectWorkspace(workspacePath);
        if (!status.isSproutgitProject) {
          toast(`"${workspaceDisplayName(workspacePath)}" is no longer a valid workspace. Removing from recents.`, 'error');
          await api.removeRecentWorkspace(workspacePath).catch(() => undefined);
          setRecents(prev => prev.filter(w => w.workspacePath !== workspacePath));
          return;
        }
      }
      await api.addRecentWorkspace(workspacePath);
      await navigate({ to: '/workspace', search: { path: workspacePath } });
    } catch (err) {
      toast(`Failed to open: ${String(err)}`, 'error');
    } finally {
      setOpening(false);
    }
  }

  async function openWithDialog() {
    setOpening(true);
    try {
      const paths = await api.showOpenDialog({ title: 'Open SproutGit Workspace', properties: ['openDirectory'] });
      if (!paths[0]) return;
      const status = await api.inspectWorkspace(paths[0]);
      if (!status.isSproutgitProject) { toast('Not a SproutGit workspace', 'error'); return; }
      await openWorkspace(status.workspacePath);
    } catch (err) {
      toast(`Open failed: ${String(err)}`, 'error');
    } finally {
      setOpening(false);
    }
  }

  async function removeRecent(workspacePath: string) {
    await api.removeRecentWorkspace(workspacePath).catch(() => undefined);
    setRecents(prev => prev.filter(w => w.workspacePath !== workspacePath));
  }

  async function browseProjectsFolder() {
    try {
      const paths = await api.showOpenDialog({ title: 'Choose projects folder', properties: ['openDirectory'] });
      if (paths[0]) {
        setProjectsFolder(paths[0]);
        void api.setSetting(PROJECTS_FOLDER_SETTING, paths[0]).catch(() => undefined);
      }
    } catch (err) {
      toast(`Failed to open folder picker: ${String(err)}`, 'error');
    }
  }

  async function browseImportPath() {
    try {
      const paths = await api.showOpenDialog({ title: 'Select Git Repository', properties: ['openDirectory'] });
      if (paths[0]) setImportPath(paths[0]);
    } catch (err) {
      toast(`Failed to open folder picker: ${String(err)}`, 'error');
    }
  }

  async function doClone(e: React.FormEvent) {
    e.preventDefault();
    setCloneError('');
    if (!projectsFolder.trim()) { setCloneError('Projects folder is required'); return; }
    if (!cloneUrl.trim()) { setCloneError('Repository URL is required'); return; }
    if (!cloneFolderName.trim()) { setCloneError('Folder name is required'); return; }
    const workspacePath = `${projectsFolder}/${cloneFolderName}`;
    setCloning(true);
    setCloneProgress([]);
    setClonePhase('');
    const offProgress = api.onGitOpProgress((ev: GitOpProgressEvent) => {
      const msg = ev.message ?? '';
      setCloneProgress(prev => [...prev, msg]);
      const phaseMatch = /^(\w[\w\s]+?):\s/.exec(msg);
      if (phaseMatch?.[1]) setClonePhase(phaseMatch[1]);
    });
    try {
      const result = await api.createWorkspace({ workspacePath, repoUrl: cloneUrl.trim() });
      offProgress();
      setShowClone(false);
      setCloneUrl(''); setCloneFolderName(''); setCloneFolderManual(false); setClonePhase('');
      await api.addRecentWorkspace(result.workspacePath);
      setRecents(prev => [
        { workspacePath: result.workspacePath, lastOpenedAt: Date.now() },
        ...prev.filter(w => w.workspacePath !== result.workspacePath),
      ]);
      toast('Cloned successfully', 'success');
      void navigate({ to: '/workspace', search: { path: result.workspacePath } });
    } catch (err) {
      offProgress();
      setCloneError(String(err));
    } finally {
      setCloning(false);
    }
  }

  async function doImport(e: React.FormEvent) {
    e.preventDefault();
    setImportError('');
    setImportProgressMsg('');
    if (!importPath.trim()) { setImportError('Repository path is required'); return; }
    const destinationWorkspacePath = importMode === 'inPlace' ? null : `${projectsFolder.trim()}/${importFolderName.trim()}`;
    setImporting(true);
    const offProgress = api.onGitOpProgress((ev: GitOpProgressEvent) => {
      setImportProgressMsg(ev.message ?? '');
    });
    try {
      const result = await api.importWorkspace({
        sourceRepoPath: importPath.trim(),
        mode: importMode,
        workspacePath: destinationWorkspacePath,
      });
      offProgress();
      setShowImport(false);
      setImportPath(''); setImportFolderName(''); setImportFolderManual(false); setImportMode('inPlace');
      await api.addRecentWorkspace(result.workspacePath);
      setRecents(prev => [
        { workspacePath: result.workspacePath, lastOpenedAt: Date.now() },
        ...prev.filter(w => w.workspacePath !== result.workspacePath),
      ]);
      toast('Imported successfully', 'success');
      void navigate({ to: '/workspace', search: { path: result.workspacePath } });
    } catch (err) {
      offProgress();
      setImportError(String(err));
    } finally {
      setImporting(false);
    }
  }

  async function generateIdea() {
    setIdeaError('');
    if (!ideaPitch.trim()) { setIdeaError('Describe your idea first'); return; }
    setIdeaGenerating(true);
    try {
      const result = await api.generateProjectIdea(ideaPitch.trim());
      if (result.error !== undefined) {
        // Still reveal the fields so the user can fill them in by hand.
        setIdeaError(result.error);
        setIdeaGenerated(true);
        return;
      }
      setIdeaName(result.name);
      setIdeaTechStack(result.techStack);
      setIdeaDescription(result.description);
      setIdeaGenerated(true);
    } catch (err) {
      setIdeaError(String(err));
      setIdeaGenerated(true);
    } finally {
      setIdeaGenerating(false);
    }
  }

  async function createIdeaProject(e: React.FormEvent) {
    e.preventDefault();
    setIdeaError('');
    if (!projectsFolder.trim()) { setIdeaError('Projects folder is required'); return; }
    if (!ideaName.trim()) { setIdeaError('Project name is required'); return; }
    const workspacePath = `${projectsFolder}/${ideaName.trim()}`;
    setIdeaCreating(true);
    try {
      const initResult = await api.createWorkspace({ workspacePath });
      await api.createWorktree({
        workspacePath,
        rootRepoPath: initResult.rootPath,
        managedWorktreesPath: initResult.worktreesPath,
        fromRef: '',
        newBranch: 'main',
        orphan: true,
      });
      setPendingScaffold(workspacePath, buildScaffoldPrompt({
        name: ideaName.trim(),
        pitch: ideaPitch.trim(),
        techStack: ideaTechStack.trim(),
        description: ideaDescription.trim(),
      }));
      setShowIdea(false);
      await api.addRecentWorkspace(workspacePath);
      setRecents(prev => [
        { workspacePath, lastOpenedAt: Date.now() },
        ...prev.filter(w => w.workspacePath !== workspacePath),
      ]);
      resetIdeaState();
      toast('Project created', 'success');
      void navigate({ to: '/workspace', search: { path: workspacePath } });
    } catch (err) {
      setIdeaError(String(err));
    } finally {
      setIdeaCreating(false);
    }
  }

  const cloneWorkspacePath = projectsFolder && cloneFolderName ? `${projectsFolder}/${cloneFolderName}` : '';
  const ideaWorkspacePath = projectsFolder && ideaName ? `${projectsFolder}/${ideaName}` : '';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-(--sg-bg)">
      {/* Git startup spinner — shown briefly while checking if git is installed */}
      {!gitChecked && (
        <div className="fixed inset-0 z-[500] bg-(--sg-bg) flex flex-col items-center justify-center gap-3">
          <Spinner size="lg" />
          <span className="text-xs text-(--sg-text-faint)">Checking git…</span>
        </div>
      )}
      {gitNotInstalled && (
        <div className="fixed inset-0 z-[500] bg-(--sg-bg) flex flex-col items-center justify-center gap-4 text-center px-8">
          <AlertTriangle size={40} className="text-yellow-500" />
          <h1 className="text-lg font-semibold text-(--sg-text) m-0">Git is not installed</h1>
          <p className="text-sm text-(--sg-text-dim) m-0 max-w-sm">SproutGit requires Git to be installed and accessible on your PATH.</p>
          <a href="https://git-scm.com/downloads" className="text-sm text-(--sg-primary) underline" onClick={e => { e.preventDefault(); void api.openUrl('https://git-scm.com/downloads'); }}>
            Download Git →
          </a>
        </div>
      )}
      {/* Titlebar */}
      <header
        className="flex items-center h-(--sg-titlebar-height) shrink-0 border-b border-(--sg-border) bg-(--sg-surface)"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <WindowControls />
        <span className="flex items-center gap-[6px] text-[13px] font-semibold text-(--sg-text) flex-1 pl-3">

          <img src={logoSvgUrl} alt="" width={18} height={18} />
          SproutGit
        </span>
        <div className="flex items-center h-full pr-2 gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <UpdateBadge state={updateState} onInstall={() => void api.installUpdate()} />
          <button className={iconBtn} title="Replay walkthrough" data-testid="btn-replay-tour" onClick={replayTour}>
            <HelpCircle size={15} />
          </button>
          <button className={iconBtn} title="New Window" onClick={() => void api.openNewWindow()}>
            <AppWindow size={15} />
          </button>
          <button className={iconBtn} title="Settings" onClick={() => void navigate({ to: '/settings' })}>
            <Settings size={15} />
          </button>
        </div>
        <WindowControls side="right" />
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        <ResizableSidebar initialWidth={240} minWidth={180} maxWidth={400}>
          <aside className="flex flex-col h-full border-r border-(--sg-border) bg-(--sg-surface) overflow-y-auto">
            <div className={sectionHeader}>
              <Play size={11} strokeWidth={2.5} style={{ color: 'var(--sg-primary)' }} />
              <span>Start</span>
            </div>

            <div className="flex flex-col gap-0.5 p-2" data-testid="home-start-actions">
              {!!agentConfig?.command.trim() && (
                <button className={actionBtn} data-testid="btn-new-from-idea" onClick={() => { resetIdeaState(); setShowIdea(true); }}>
                  <span className={actionIcon}><Sparkles size={14} strokeWidth={2} /></span>
                  <span>New from idea</span>
                  <ArrowRight size={13} className="ml-auto text-(--sg-text-faint) opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )}

              <button className={actionBtn} data-testid="btn-clone" onClick={() => { setCloneError(''); setCloneProgress([]); setShowClone(true); }}>
                <span className={actionIcon}><Download size={14} strokeWidth={2} /></span>
                <span>Clone</span>
                <ArrowRight size={13} className="ml-auto text-(--sg-text-faint) opacity-0 transition-opacity group-hover:opacity-100" />
              </button>

              <button className={actionBtn} data-testid="btn-open" disabled={opening} onClick={() => void openWithDialog()}>
                <span className={actionIcon}>{opening ? <Spinner size="sm" /> : <FolderOpen size={14} strokeWidth={2} />}</span>
                <span>{opening ? 'Opening…' : 'Open Folder'}</span>
                <ArrowRight size={13} className="ml-auto text-(--sg-text-faint) opacity-0 transition-opacity group-hover:opacity-100" />
              </button>

              <button className={actionBtn} data-testid="btn-import" onClick={() => { setImportError(''); setShowImport(true); }}>
                <span className={actionIcon}><FolderInput size={14} strokeWidth={2} /></span>
                <span>Import Git Repo</span>
                <ArrowRight size={13} className="ml-auto text-(--sg-text-faint) opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </div>

            {appVersion && (
              <div className="mt-auto px-[14px] py-[10px] text-[10px] text-(--sg-text-faint) text-center">
                SproutGit {appVersion}
              </div>
            )}
          </aside>
        </ResizableSidebar>

        {/* Main */}
        <main className="flex-1 min-w-0 flex flex-col bg-(--sg-bg)" data-testid="recent-projects-panel">
          <div className={`${sectionHeader} bg-(--sg-surface)`}>
            <Clock size={11} strokeWidth={2.5} style={{ color: 'var(--sg-primary)' }} />
            <span>Recent projects</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {recents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-[10px] text-center">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[color-mix(in_srgb,var(--sg-primary)_10%,transparent)] text-(--sg-primary)">
                  <FolderOpen size={20} strokeWidth={2} />
                </div>
                <p className="text-[13px] font-semibold text-(--sg-text) m-0">No projects yet</p>
                <p className="text-xs text-(--sg-text-faint) mt-0.5 mb-0">Clone a repo or open a folder to get started.</p>
              </div>
            ) : (
              <ul className="list-none m-0 p-0 flex flex-col gap-px" data-testid="recent-projects">
                {recents.map(ws => {
                  const name = workspaceDisplayName(ws.workspacePath);
                  return (
                    <li key={ws.workspacePath} className="group flex items-center rounded-lg hover:bg-(--sg-surface-raised)" data-testid="recent-project" data-workspace={ws.workspacePath}>
                      <button
                        className="flex items-center gap-[10px] flex-1 px-[10px] py-2 cursor-pointer min-w-0 text-left bg-transparent border-none rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void openWorkspace(ws.workspacePath, true)}
                        disabled={opening}
                        data-testid="recent-project-open"
                      >
                        <div className="w-8 h-8 rounded-lg bg-(--sg-avatar-bg) text-(--sg-avatar-text) text-sm font-bold flex items-center justify-center shrink-0">
                          {name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <span className="text-[13px] font-medium text-(--sg-text) whitespace-nowrap overflow-hidden text-ellipsis">{name}</span>
                          <span className="text-[11px] text-(--sg-text-faint) whitespace-nowrap overflow-hidden text-ellipsis">{ws.workspacePath}</span>
                        </div>
                        <span className="text-[11px] text-(--sg-text-faint) shrink-0 whitespace-nowrap">{formatRelativeDate(ws.lastOpenedAt)}</span>
                      </button>
                      <button
                        className="flex items-center justify-center p-[6px] rounded-[6px] cursor-pointer text-(--sg-text-faint) bg-transparent border-none opacity-0 transition-[opacity,color] group-hover:opacity-100 hover:text-(--sg-danger)"
                        title="Remove from recent"
                        onClick={e => { e.stopPropagation(); void removeRecent(ws.workspacePath); }}
                      >
                        <X size={13} />
                      </button>
                      <button
                        className="flex items-center justify-center p-[6px] rounded-[6px] cursor-pointer text-(--sg-text-faint) bg-transparent border-none hover:text-(--sg-text) disabled:cursor-not-allowed disabled:opacity-40"
                        title="Open workspace"
                        onClick={() => void openWorkspace(ws.workspacePath, true)}
                        disabled={opening}
                      >
                        <ArrowRight size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </main>
      </div>

      {/* Clone Dialog */}
      {showClone && (
        <div
          className="fixed inset-0 z-200 bg-black/45 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setShowClone(false); }}
          data-testid="clone-dialog"
        >
          <form
            className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-5 min-w-[440px] max-w-[520px] shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
            onSubmit={e => void doClone(e)}
          >
            <div className="flex items-start gap-[10px] mb-[18px]">
              <span className="flex items-center justify-center w-[30px] h-[30px] rounded-lg bg-[color-mix(in_srgb,var(--sg-primary)_15%,transparent)] text-(--sg-primary) shrink-0">
                <Download size={14} />
              </span>
              <div className="flex-1">
                <h2 className="text-[15px] font-semibold m-0 mb-[10px] text-(--sg-text) font-[family-name:var(--sg-font-heading)]">Clone Repository</h2>
                <p className="text-[11px] text-(--sg-text-faint) mt-0.5 mb-0">Pull a remote into a fresh SproutGit workspace</p>
              </div>
              <button type="button" className={iconBtn} onClick={() => setShowClone(false)}><X size={14} /></button>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className={fieldLabel}>Repository URL</span>
                {githubRepos.length > 0 ? (
                  <Autocomplete
                    options={githubRepos.map(r => ({
                      label: r.fullName,
                      value: r.cloneUrl,
                      ...(r.description ? { description: r.description } : {}),
                    }))}
                    value={cloneUrl}
                    onChange={url => setCloneUrl(url)}
                    placeholder="https://github.com/owner/repo.git"
                    disabled={cloning}
                  />
                ) : (
                  <input ref={cloneUrlRef} className={fieldInput} type="url" value={cloneUrl} onChange={e => setCloneUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" required disabled={cloning} spellCheck={false} />
                )}
              </label>
              <label className="flex flex-col gap-1">
                <span className={fieldLabel}>Folder name</span>
                <input className={fieldInput} value={cloneFolderName} onChange={e => { setCloneFolderName(e.target.value); setCloneFolderManual(e.target.value !== '' && e.target.value !== repoNameFromUrl(cloneUrl)); }} placeholder="my-repo" required disabled={cloning} spellCheck={false} />
              </label>
              <div className="flex flex-col gap-1">
                <span className={fieldLabel}>Parent folder</span>
                <div className="flex gap-[6px] items-center">
                  <input className={fieldInput} value={projectsFolder} onChange={e => setProjectsFolder(e.target.value)}
                    onBlur={() => { if (projectsFolder.trim()) void api.setSetting(PROJECTS_FOLDER_SETTING, projectsFolder.trim()).catch(() => undefined); }}
                    placeholder="~/Projects" disabled={cloning} spellCheck={false} />
                  <button type="button" className={secondaryBtn} onClick={() => void browseProjectsFolder()} disabled={cloning}><FolderOpen size={13} /></button>
                </div>
              </div>
              {cloneWorkspacePath && (
                <p className="text-[11px] text-(--sg-text-faint) m-0">
                  Will create: <code>{cloneWorkspacePath}</code>
                </p>
              )}
              {cloneProgress.length > 0 && (() => {
                // H4: Extract latest percentage from progress messages
                const lastPct = cloneProgress.reduceRight<number | null>((acc, line) => {
                  if (acc !== null) return acc;
                  const m = /(\d+)%/.exec(line);
                  return m?.[1] ? parseInt(m[1], 10) : null;
                }, null);
                return (
                  <div>
                    {clonePhase && <p className="text-[10px] text-(--sg-text-faint) m-0 mb-1">{clonePhase}…</p>}
                    {lastPct !== null && (
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex-1 h-1.5 bg-(--sg-input-bg) rounded-full overflow-hidden">
                          <div className="h-full bg-(--sg-primary) rounded-full transition-[width]" style={{ width: `${lastPct}%` }} />
                        </div>
                        <span className="text-[10px] font-medium text-(--sg-text-dim) shrink-0">{lastPct}%</span>
                      </div>
                    )}
                    <div className="max-h-[100px] overflow-y-auto bg-(--sg-input-bg) border border-(--sg-border) rounded-[6px] p-[6px_8px] font-(family-name:--sg-font-code) text-[11px] text-(--sg-text-dim)">
                      {cloneProgress.map((line, i) => <div key={i} className="whitespace-pre-wrap break-all">{line}</div>)}
                      <div ref={progressEndRef} />
                    </div>
                  </div>
                );
              })()}
              {cloneError && <p className="text-xs text-(--sg-danger) m-0">{cloneError}</p>}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button type="button" className={secondaryBtn} onClick={() => setShowClone(false)} disabled={cloning}>Cancel</button>
              <button type="submit" className={primaryBtn} disabled={cloning}>
                {cloning ? <><Spinner size="sm" /> Cloning…</> : 'Clone'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Import Dialog */}
      {showImport && (
        <div
          className="fixed inset-0 z-200 bg-black/45 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setShowImport(false); }}
          data-testid="import-dialog"
        >
          <form
            className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-5 min-w-[440px] max-w-[520px] shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
            onSubmit={e => void doImport(e)}
          >
            <div className="flex items-start gap-[10px] mb-[18px]">
              <span className="flex items-center justify-center w-[30px] h-[30px] rounded-lg bg-[color-mix(in_srgb,var(--sg-primary)_15%,transparent)] text-(--sg-primary) shrink-0">
                <FolderInput size={14} />
              </span>
              <div className="flex-1">
                <h2 className="text-[15px] font-semibold m-0 mb-[10px] text-(--sg-text) font-[family-name:var(--sg-font-heading)]">Import Git Repository</h2>
                <p className="text-[11px] text-(--sg-text-faint) mt-0.5 mb-0">Create a SproutGit workspace from an existing repo</p>
              </div>
              <button type="button" className={iconBtn} onClick={() => setShowImport(false)}><X size={14} /></button>
            </div>
            <div className="flex flex-col gap-3">
              {/* Import mode selector */}
              <div className="flex flex-col gap-1.5">
                <span className={fieldLabel}>How to import</span>
                {(['inPlace', 'move', 'copy'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${importMode === mode ? 'border-(--sg-primary) bg-[color-mix(in_srgb,var(--sg-primary)_10%,transparent)]' : 'border-(--sg-border) hover:bg-(--sg-surface-raised)'} cursor-pointer`}
                    onClick={() => setImportMode(mode)}
                    disabled={importing}
                  >
                    <div className={`font-semibold ${importMode === mode ? 'text-(--sg-primary)' : 'text-(--sg-text)'}`}>
                      {mode === 'inPlace' ? 'Import in place' : mode === 'move' ? 'Move to new workspace' : 'Copy to new workspace'}
                    </div>
                    <div className="mt-0.5 text-(--sg-text-faint) text-[10.5px] leading-snug">
                      {mode === 'inPlace' ? 'Restructure the folder in-situ — repo becomes root in the same parent directory.' :
                        mode === 'move' ? 'Move repo into a new SproutGit workspace folder and remove the original location.' :
                          'Copy repo into a new SproutGit workspace folder and leave the original location untouched.'}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <span className={fieldLabel}>Repository path</span>
                <div className="flex gap-[6px] items-center">
                  <input ref={importPathRef} className="flex-1 px-[10px] py-[6px] bg-(--sg-input-bg) border border-(--sg-input-border) rounded-[6px] text-xs text-(--sg-text) outline-none focus:border-(--sg-input-focus)" value={importPath} onChange={e => setImportPath(e.target.value)} placeholder="/Users/me/my-repo" required disabled={importing} spellCheck={false} />
                  <button type="button" className={secondaryBtnSm} onClick={() => void browseImportPath()} disabled={importing}><FolderOpen size={13} /></button>
                </div>
              </div>
              {(importMode === 'move' || importMode === 'copy') && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>Workspace folder name</span>
                    <input className={fieldInput} value={importFolderName} onChange={e => { setImportFolderName(e.target.value); setImportFolderManual(true); }} placeholder="my-repo" disabled={importing} spellCheck={false} />
                  </label>
                  <div className="flex flex-col gap-1">
                    <span className={fieldLabel}>Parent folder</span>
                    <div className="flex gap-[6px] items-center">
                      <input className={fieldInput} value={projectsFolder} onChange={e => setProjectsFolder(e.target.value)}
                        onBlur={() => { if (projectsFolder.trim()) void api.setSetting(PROJECTS_FOLDER_SETTING, projectsFolder.trim()).catch(() => undefined); }}
                        placeholder="~/Projects" disabled={importing} spellCheck={false} />
                      <button type="button" className={secondaryBtnSm} onClick={() => void browseProjectsFolder()} disabled={importing}><FolderOpen size={13} /></button>
                    </div>
                  </div>
                </>
              )}
              {importError && <p className="text-xs text-(--sg-danger) m-0">{importError}</p>}
              {importing && importProgressMsg && (
                <p className="truncate text-[10px] text-(--sg-text-faint) m-0">{importProgressMsg}</p>
              )}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button type="button" className={secondaryBtn} onClick={() => setShowImport(false)} disabled={importing}>Cancel</button>
              <button type="submit" className={primaryBtn} disabled={importing}>
                {importing ? <><Spinner size="sm" /> Importing…</> : 'Import'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New from idea Dialog */}
      {showIdea && (
        <div
          className="fixed inset-0 z-200 bg-black/45 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setShowIdea(false); }}
          data-testid="idea-dialog"
        >
          <form
            className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-5 min-w-[440px] max-w-[520px] shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
            onSubmit={e => void createIdeaProject(e)}
          >
            <div className="flex items-start gap-[10px] mb-[18px]">
              <span className="flex items-center justify-center w-[30px] h-[30px] rounded-lg bg-[color-mix(in_srgb,var(--sg-primary)_15%,transparent)] text-(--sg-primary) shrink-0">
                <Sparkles size={14} />
              </span>
              <div className="flex-1">
                <h2 className="text-[15px] font-semibold m-0 mb-[10px] text-(--sg-text) font-[family-name:var(--sg-font-heading)]">New from idea</h2>
                <p className="text-[11px] text-(--sg-text-faint) mt-0.5 mb-0">Pitch a project — your AI agent names it, picks a stack, and scaffolds it</p>
              </div>
              <button type="button" className={iconBtn} onClick={() => setShowIdea(false)}><X size={14} /></button>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className={fieldLabel}>Your idea</span>
                <textarea
                  ref={ideaPitchRef}
                  className={`${fieldInput} min-h-[70px] resize-none`}
                  value={ideaPitch}
                  onChange={e => setIdeaPitch(e.target.value)}
                  placeholder="A CLI that turns a changelog into release notes…"
                  required
                  disabled={ideaGenerating || ideaCreating}
                  spellCheck={false}
                  data-testid="input-idea-pitch"
                />
              </label>

              {!ideaGenerated && (
                <div className="flex justify-end">
                  <button type="button" className={secondaryBtn} onClick={() => void generateIdea()} disabled={ideaGenerating || !ideaPitch.trim()} data-testid="btn-idea-generate">
                    {ideaGenerating ? <><Spinner size="sm" /> Thinking…</> : 'Generate name & stack'}
                  </button>
                </div>
              )}

              {ideaGenerated && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>Project name</span>
                    <input className={fieldInput} value={ideaName} onChange={e => setIdeaName(e.target.value)} placeholder="my-project" required disabled={ideaCreating} spellCheck={false} data-testid="input-idea-name" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>Tech stack</span>
                    <input className={fieldInput} value={ideaTechStack} onChange={e => setIdeaTechStack(e.target.value)} placeholder="Node.js + TypeScript" disabled={ideaCreating} spellCheck={false} data-testid="input-idea-stack" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>Description</span>
                    <input className={fieldInput} value={ideaDescription} onChange={e => setIdeaDescription(e.target.value)} disabled={ideaCreating} spellCheck={false} data-testid="input-idea-description" />
                  </label>
                  <div className="flex flex-col gap-1">
                    <span className={fieldLabel}>Parent folder</span>
                    <div className="flex gap-[6px] items-center">
                      <input className={fieldInput} value={projectsFolder} onChange={e => setProjectsFolder(e.target.value)}
                        onBlur={() => { if (projectsFolder.trim()) void api.setSetting(PROJECTS_FOLDER_SETTING, projectsFolder.trim()).catch(() => undefined); }}
                        placeholder="~/Projects" disabled={ideaCreating} spellCheck={false} data-testid="input-idea-parent-folder" />
                      <button type="button" className={secondaryBtn} onClick={() => void browseProjectsFolder()} disabled={ideaCreating}><FolderOpen size={13} /></button>
                    </div>
                  </div>
                  {ideaWorkspacePath && (
                    <p className="text-[11px] text-(--sg-text-faint) m-0">
                      Will create: <code>{ideaWorkspacePath}</code> — the agent will scaffold boilerplate automatically once it opens.
                    </p>
                  )}
                </>
              )}

              {ideaError && <p className="text-xs text-(--sg-danger) m-0">{ideaError}</p>}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button type="button" className={secondaryBtn} onClick={() => setShowIdea(false)} disabled={ideaCreating}>Cancel</button>
              {ideaGenerated && (
                <button type="submit" className={primaryBtn} disabled={ideaCreating || !ideaName.trim()} data-testid="btn-idea-create">
                  {ideaCreating ? <><Spinner size="sm" /> Creating…</> : 'Create Project'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeView,
});
