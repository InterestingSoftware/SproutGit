import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Minus, FilePlus, Pencil, FileMinus, FileText, File, Sparkles } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import typescriptLang from 'highlight.js/lib/languages/typescript';
import javascriptLang from 'highlight.js/lib/languages/javascript';
import rustLang from 'highlight.js/lib/languages/rust';
import cssLang from 'highlight.js/lib/languages/css';
import jsonLang from 'highlight.js/lib/languages/json';
import xmlLang from 'highlight.js/lib/languages/xml';
import bashLang from 'highlight.js/lib/languages/bash';
import markdownLang from 'highlight.js/lib/languages/markdown';
import yamlLang from 'highlight.js/lib/languages/yaml';
import sqlLang from 'highlight.js/lib/languages/sql';
import pythonLang from 'highlight.js/lib/languages/python';
import goLang from 'highlight.js/lib/languages/go';
import { type StatusFileEntry, type WorktreeStatusResult, type CommitMessageGenerateResult } from '@sproutgit/types';
import { Spinner } from './Spinner.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { escapeHtml } from '../html-escape.js';

hljs.registerLanguage('typescript', typescriptLang);
hljs.registerLanguage('javascript', javascriptLang);
hljs.registerLanguage('rust', rustLang);
hljs.registerLanguage('css', cssLang);
hljs.registerLanguage('json', jsonLang);
hljs.registerLanguage('xml', xmlLang);
hljs.registerLanguage('bash', bashLang);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('yaml', yamlLang);
hljs.registerLanguage('sql', sqlLang);
hljs.registerLanguage('python', pythonLang);
hljs.registerLanguage('go', goLang);

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  worktreePath: string;
  branch: string | null;
  /** Async function injected by the caller — calls the Electron IPC. */
  getStatus: (worktreePath: string) => Promise<WorktreeStatusResult>;
  stageFiles: (worktreePath: string, paths: string[]) => Promise<void>;
  unstageFiles: (worktreePath: string, paths: string[]) => Promise<void>;
  createCommit: (worktreePath: string, message: string) => Promise<void>;
  getDiff: (worktreePath: string, staged: boolean, file?: string) => Promise<string>;
  onCommit: () => void;
  onClose: () => void;
  onStatusChange?: (count: number) => void;
  /** Increment from outside to trigger a status reload (e.g. file watcher). */
  refreshSignal?: number;
  onToast?: (message: string, variant: 'success' | 'error') => void;
  /** Runs the configured AI commit-message generator against the staged diff. */
  generateCommitMessage?: (worktreePath: string) => Promise<CommitMessageGenerateResult>;
};

// ─── Validation ───────────────────────────────────────────────────────────────

function validateCommitMessage(msg: string): string | null {
  const trimmed = msg.trim();
  if (!trimmed) return 'Commit message is required';
  if (trimmed.length > 72) return 'First line should be 72 characters or fewer';
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Staging panel: lists staged/unstaged files, shows diffs, and lets the user
 * commit. All git operations are provided as async prop callbacks — the
 * component itself has no direct IPC dependency.
 */
export function StagingPanel({
  worktreePath,
  branch,
  getStatus,
  stageFiles: stageFilesFn,
  unstageFiles: unstageFilesFn,
  createCommit: createCommitFn,
  getDiff,
  onCommit,
  onClose,
  onStatusChange,
  refreshSignal = 0,
  onToast,
  generateCommitMessage,
}: Props) {
  const qc = useQueryClient();
  const statusKey = ['stagingStatus', worktreePath, refreshSignal] as const;

  // ── Server state ─────────────────────────────────────────────────────

  const { data: statusFiles = [], isLoading: loading } = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      const result = await getStatus(worktreePath);
      onStatusChange?.(result.files.length);
      return result.files as StatusFileEntry[];
    },
    staleTime: 0, // always re-fetch when key changes
    refetchInterval: 3_000, // poll for file changes not caught by the git watcher
    retry: 0,
    // Don't bubble status errors to the global QueryCache.onError toast —
    // transient failures (e.g. worktree deleted mid-flight) are self-healing.
    throwOnError: false,
  });

  const stagedFiles = statusFiles.filter(f => f.indexStatus !== ' ' && f.indexStatus !== '?');
  const unstagedFiles = statusFiles.filter(f => f.workTreeStatus !== ' ');

  function invalidateStatus() {
    void qc.invalidateQueries({ queryKey: ['stagingStatus', worktreePath] });
  }

  // ── Mutations ───────────────────────────────────────────────────────

  const stageOne = useMutation({
    mutationFn: (path: string) => stageFilesFn(worktreePath, [path]),
    onSuccess: invalidateStatus,
    onError: (err) => onToast?.(`Failed to stage: ${String(err)}`, 'error'),
  });

  const stageAll = useMutation({
    mutationFn: () => stageFilesFn(worktreePath, unstagedFiles.map(f => f.path)),
    onSuccess: invalidateStatus,
    onError: (err) => onToast?.(`Failed to stage all: ${String(err)}`, 'error'),
  });

  const unstageOne = useMutation({
    mutationFn: (path: string) => unstageFilesFn(worktreePath, [path]),
    onSuccess: invalidateStatus,
    onError: (err) => onToast?.(`Failed to unstage: ${String(err)}`, 'error'),
  });

  const unstageAll = useMutation({
    mutationFn: () => unstageFilesFn(worktreePath, stagedFiles.map(f => f.path)),
    onSuccess: invalidateStatus,
    onError: (err) => onToast?.(`Failed to unstage all: ${String(err)}`, 'error'),
  });

  const commitMutation = useMutation({
    mutationFn: (message: string) => createCommitFn(worktreePath, message),
    onSuccess: () => {
      setCommitMessage('');
      setCommitTouched(false);
      onToast?.('Committed!', 'success');
      invalidateStatus();
      onCommit();
    },
    onError: (err) => onToast?.(`Commit failed: ${String(err)}`, 'error'),
  });

  // ── Local UI state ──────────────────────────────────────────────────

  const [commitMessage, setCommitMessage] = useState('');
  const [commitTouched, setCommitTouched] = useState(false);
  const [diffContent, setDiffContent] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffStaged, setDiffStaged] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const commitError = commitTouched ? validateCommitMessage(commitMessage) : null;

  async function runGenerateCommitMessage() {
    if (!generateCommitMessage) return;
    setConfirmOverwrite(false);
    setGenerating(true);
    try {
      const result = await generateCommitMessage(worktreePath);
      if (result.message) {
        setCommitMessage(result.message);
        setCommitTouched(true);
      } else {
        onToast?.(result.error ?? 'Generator produced no output.', 'error');
      }
    } catch (err) {
      onToast?.(`Failed to generate message: ${String(err)}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  function handleGenerateClick() {
    if (commitMessage.trim()) {
      setConfirmOverwrite(true);
      return;
    }
    void runGenerateCommitMessage();
  }

  async function loadDiff(file: string | null, staged: boolean) {
    setDiffFile(file);
    setDiffStaged(staged);
    setDiffLoading(true);
    setDiffError(null);
    try {
      const content = await getDiff(worktreePath, staged, file ?? undefined);
      setDiffContent(content);
    } catch (err) {
      onToast?.(`Failed to load diff: ${String(err)}`, 'error');
      setDiffContent('');
      setDiffError(String(err));
    } finally {
      setDiffLoading(false);
    }
  }

  function handleCommit() {
    setCommitTouched(true);
    if (validateCommitMessage(commitMessage)) return;
    if (stagedFiles.length === 0) {
      onToast?.('No staged changes to commit', 'error');
      return;
    }
    commitMutation.mutate(commitMessage);
  }

  // ─── Diff rendering ──────────────────────────────────────────────────────────

  function renderDiff(raw: string): string {
    if (!raw.trim()) return '<span class="sg-diff-empty">No changes</span>';
    const lang = languageForPath(diffFile);
    const lines = raw.split('\n');
    return lines.map(line => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `<div class="sg-diff-add">+${highlightCode(line.slice(1), lang)}</div>`;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        return `<div class="sg-diff-del">-${highlightCode(line.slice(1), lang)}</div>`;
      } else if (line.startsWith('@@')) {
        return `<div class="sg-diff-hunk">${escapeHtml(line)}</div>`;
      } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        return `<div class="sg-diff-meta">${escapeHtml(line)}</div>`;
      }
      if (line.startsWith(' ')) {
        return `<div class="sg-diff-ctx"> ${highlightCode(line.slice(1), lang)}</div>`;
      }
      return `<div class="sg-diff-ctx">${highlightCode(line, lang)}</div>`;
    }).join('');
  }

  // ─── Resize state ─────────────────────────────────────────────────────────

  const [leftWidth, setLeftWidth] = useState(260);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const [unstagedRatio, setUnstagedRatio] = useState(0.55);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const splitDraggingRef = useRef(false);
  const splitStartYRef = useRef(0);
  const splitStartRatioRef = useRef(unstagedRatio);

  function onDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = leftWidth;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(480, Math.max(180, startWidthRef.current + (ev.clientX - startXRef.current)));
      setLeftWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onListSplitMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const container = listContainerRef.current;
    if (!container) return;

    splitDraggingRef.current = true;
    splitStartYRef.current = e.clientY;
    splitStartRatioRef.current = unstagedRatio;

    const onMove = (ev: MouseEvent) => {
      if (!splitDraggingRef.current) return;
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;
      const deltaRatio = (ev.clientY - splitStartYRef.current) / rect.height;
      const nextRatio = Math.min(0.8, Math.max(0.2, splitStartRatioRef.current + deltaRatio));
      setUnstagedRatio(nextRatio);
    };

    const onUp = () => {
      splitDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const iconBtn = 'inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised) disabled:opacity-40 disabled:cursor-not-allowed';
  const sectionHdr = 'flex items-center justify-between px-[10px] py-[5px] text-[11px] font-semibold text-(--sg-text-faint) uppercase tracking-[0.04em] shrink-0 border-b border-(--sg-border-subtle) bg-(--sg-surface)';
  const fileRow = (active: boolean) => `sg-file-row flex items-center gap-1.5 px-[10px] py-[3px] text-xs cursor-pointer transition-colors border-l-2 ${active ? 'bg-[color-mix(in_srgb,var(--sg-primary)_14%,transparent)] border-l-(--sg-primary)' : 'border-l-transparent hover:bg-(--sg-surface-raised)'}`;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left column: file lists + commit form ── */}
      <div className="shrink-0 flex flex-col overflow-hidden" style={{ width: leftWidth }}>
        {loading ? (
          <div className="flex items-center justify-center flex-1"><Spinner /></div>
        ) : (
          <>
            {/* Scrollable file lists */}
            <div ref={listContainerRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Unstaged files */}
              <div className="min-h-0 flex flex-col" style={{ flex: `${unstagedRatio} 1 0%` }}>
                <div className={sectionHdr}>
                  <span>Unstaged ({unstagedFiles.length})</span>
                  {unstagedFiles.length > 0 && (
                    <button className={iconBtn} onClick={() => stageAll.mutate()} title="Stage all" disabled={stageAll.isPending}>
                      {stageAll.isPending ? <Spinner size="sm" /> : <Plus size={12} />}
                    </button>
                  )}
                </div>
                <div className="overflow-y-auto flex-1 min-h-0">
                  {unstagedFiles.length === 0 && (
                    <p className="px-[10px] py-2 text-[11px] text-(--sg-text-faint) italic">No unstaged changes</p>
                  )}
                  {unstagedFiles.map(f => (
                    <div
                      key={f.path}
                      data-testid="staging-unstaged-file-row"
                      data-path={f.path}
                      className={fileRow(diffFile === f.path && !diffStaged)}
                      onClick={() => void loadDiff(f.path, false)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') void loadDiff(f.path, false); }}
                    >
                      <StatusIcon status={f.workTreeStatus} />
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{f.path}</span>
                      <button
                        className={iconBtn}
                        onClick={e => { e.stopPropagation(); stageOne.mutate(f.path); }}
                        disabled={stageOne.isPending && stageOne.variables === f.path}
                        title="Stage file"
                      >
                        {stageOne.isPending && stageOne.variables === f.path ? <Spinner size="sm" /> : <Plus size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="h-1 shrink-0 cursor-row-resize bg-(--sg-border) hover:bg-(--sg-primary) active:bg-(--sg-primary) transition-colors"
                onMouseDown={onListSplitMouseDown}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize unstaged and staged panels"
              />

              {/* Staged files */}
              <div className="min-h-0 flex flex-col border-t border-(--sg-border)" style={{ flex: `${1 - unstagedRatio} 1 0%` }}>
                <div className={sectionHdr}>
                  <span>Staged ({stagedFiles.length})</span>
                  {stagedFiles.length > 0 && (
                    <button className={iconBtn} onClick={() => unstageAll.mutate()} title="Unstage all" disabled={unstageAll.isPending}>
                      {unstageAll.isPending ? <Spinner size="sm" /> : <Minus size={12} />}
                    </button>
                  )}
                </div>
                <div className="overflow-y-auto flex-1 min-h-0">
                  {stagedFiles.length === 0 && (
                    <p className="px-[10px] py-2 text-[11px] text-(--sg-text-faint) italic">No staged changes</p>
                  )}
                  {stagedFiles.map(f => (
                    <div
                      key={f.path}
                      data-testid="staging-staged-file-row"
                      data-path={f.path}
                      className={fileRow(diffFile === f.path && diffStaged)}
                      onClick={() => void loadDiff(f.path, true)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') void loadDiff(f.path, true); }}
                    >
                      <span className="sg-file-status--staged inline-flex shrink-0" data-status={f.indexStatus}>
                        <StatusIcon status={f.indexStatus} />
                      </span>
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{f.path}</span>
                      <button
                        className={iconBtn}
                        onClick={e => { e.stopPropagation(); unstageOne.mutate(f.path); }}
                        disabled={unstageOne.isPending && unstageOne.variables === f.path}
                        title="Unstage file"
                      >
                        {unstageOne.isPending && unstageOne.variables === f.path ? <Spinner size="sm" /> : <Minus size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Commit area */}
            <section
              className="px-3 py-2 flex flex-col gap-1.5 border-t border-(--sg-border) shrink-0"
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleCommit();
                }
              }}
            >
              <div className="relative">
                <textarea
                  className={`sg-commit-input w-full resize-none bg-(--sg-input-bg) border rounded px-2 py-1.5 pr-7 text-xs text-(--sg-text) placeholder:text-(--sg-text-faint) outline-none focus:border-(--sg-input-focus) ${commitError ? 'border-(--sg-danger) focus:border-(--sg-danger)' : 'border-(--sg-input-border)'}`}
                  placeholder="Commit message"
                  value={commitMessage}
                  onChange={e => { setCommitMessage(e.target.value); setCommitTouched(true); }}
                  rows={3}
                />
                {generateCommitMessage && (
                  <button
                    data-testid="btn-generate-commit-message"
                    className="absolute right-1.5 top-1.5 inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-primary) hover:bg-(--sg-surface-raised) disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={handleGenerateClick}
                    disabled={generating || stagedFiles.length === 0}
                    title={stagedFiles.length === 0 ? 'Stage changes to generate a message' : 'Generate commit message from staged diff'}
                  >
                    {generating ? <Spinner size="sm" /> : <Sparkles size={13} />}
                  </button>
                )}
              </div>
              {commitError && <p className="text-[10px] text-(--sg-danger) mt-0.5 m-0">{commitError}</p>}
              <button
                className="sg-btn--primary mt-1 flex w-full items-center justify-center gap-2 rounded bg-(--sg-primary) px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-(--sg-primary-hover) disabled:cursor-not-allowed disabled:opacity-40 border-none cursor-pointer transition-colors"
                onClick={() => handleCommit()}
                disabled={commitMutation.isPending || stagedFiles.length === 0}
                title={stagedFiles.length === 0 ? 'Stage changes first' : `Commit staged changes (${/mac/i.test(navigator.platform) ? '⌘↵' : 'Ctrl+Enter'})`}
              >
                {commitMutation.isPending ? <><Spinner size="sm" /> Committing…</> : `Commit${stagedFiles.length > 0 ? ` (${stagedFiles.length} file${stagedFiles.length !== 1 ? 's' : ''})` : ''}`}
              </button>
              <p className="text-center text-[9px] text-(--sg-text-faint) m-0">{/mac/i.test(navigator.platform) ? '⌘↵' : 'Ctrl+Enter'} to commit</p>
            </section>
          </>
        )}
      </div>

      {/* ── Drag handle ── */}
      <div
        className="w-1 shrink-0 cursor-col-resize hover:bg-(--sg-primary) active:bg-(--sg-primary) transition-colors bg-(--sg-border) z-10"
        onMouseDown={onDividerMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
      />

      {/* ── Right column: diff viewer ── */}
      <div className="flex-1 overflow-auto bg-(--sg-surface) min-w-0">
        {diffLoading ? (
          <div className="flex items-center justify-center h-full"><Spinner /></div>
        ) : diffError && diffFile ? (
          <div className="flex flex-col items-center justify-center h-full text-xs text-(--sg-danger) gap-1 px-6 text-center">
            <span>Failed to load diff for selected file.</span>
            <span className="text-(--sg-text-faint)">{diffFile}</span>
          </div>
        ) : diffFile && !diffContent.trim() ? (
          <div className="flex flex-col items-center justify-center h-full text-xs text-(--sg-text-faint) gap-1 px-6 text-center">
            <span>No diff content for selected file.</span>
            <span className="text-[11px] font-(family-name:--sg-font-code)">{diffFile}</span>
          </div>
        ) : diffContent ? (
          <pre
            className="sg-diff"
            dangerouslySetInnerHTML={{ __html: renderDiff(diffContent) }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-(--sg-text-faint)">
            Select a file to view its diff
          </div>
        )}
      </div>

      {confirmOverwrite && (
        <ConfirmDialog
          title="Replace commit message?"
          message="The commit message box already has text. Generating a new message will replace it."
          confirmLabel="Replace"
          onConfirm={() => void runGenerateCommitMessage()}
          onCancel={() => setConfirmOverwrite(false)}
        />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const extToLang: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  rs: 'rust',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  html: 'xml',
  svg: 'xml',
  sh: 'bash',
  zsh: 'bash',
  bash: 'bash',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  py: 'python',
  go: 'go',
};

function languageForPath(path: string | null): string | null {
  if (!path) return null;
  const ext = path.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return extToLang[ext] ?? null;
}

function highlightCode(code: string, language: string | null): string {
  if (!language || !code) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

function StatusIcon({ status }: { status: string }) {
  const color = fileStatusColor(status);
  if (status === '?' || status === 'A') return <FilePlus size={12} style={{ color }} className="shrink-0" />;
  if (status === 'M' || status === 'U') return <Pencil size={12} style={{ color }} className="shrink-0" />;
  if (status === 'D') return <FileMinus size={12} style={{ color }} className="shrink-0" />;
  if (status === 'R') return <FileText size={12} style={{ color }} className="shrink-0" />;
  return <File size={12} style={{ color: 'var(--sg-text-faint)' }} className="shrink-0" />;
}

function fileStatusColor(status: string): string {
  const map: Record<string, string> = {
    M: 'var(--sg-warning)',
    A: 'var(--sg-accent)',
    D: 'var(--sg-danger)',
    R: 'var(--sg-primary)',
    U: 'var(--sg-warning)',
  };
  return map[status] ?? 'var(--sg-text-faint)';
}
