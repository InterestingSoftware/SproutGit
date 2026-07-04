import { User, Code2, Diff, GitMerge, Pencil, GitBranch } from 'lucide-react';
import { api } from '../api.js';
import { useState, useEffect } from 'react';
import type {
  EditorInfo,
  GitHubAuthStatus,
  GitHubEmailSuggestion,
  GitToolInfo,
} from '@sproutgit/types';
import { Spinner, type ToastData } from '@sproutgit/ui';
import { SettingsToolRow } from './SettingsToolRow.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function commandToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const stripped = trimmed
    .replace(/^"([\s\S]*)"(?:\s.*)?$/, '$1')
    .replace(/^'([\s\S]*)'(?:\s.*)?$/, '$1');
  const first = stripped.split(/\s+/)[0] ?? '';
  const normalized = first.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  const parts = normalized.split('/');
  return (parts[parts.length - 1] ?? normalized).toLowerCase();
}

function fallbackDisplay(value: string): { id: string; name: string } {
  const token = commandToken(value);
  const base = token || value.trim();
  return { id: token || 'custom', name: titleCase(base) };
}

function matchesEditor(editor: EditorInfo, configured: string): boolean {
  const stripped = configured.replace(/^["']|["']$/g, '');
  const cmd = stripped.split(/\s+--?\w/)[0]?.trim() ?? '';
  return cmd === editor.command || stripped.startsWith(editor.command);
}

function quoteCommand(command: string): string {
  return command.includes(' ') ? `"${command}"` : command;
}

function editorCommand(editor: EditorInfo): string {
  const waits = ['vscode', 'cursor', 'windsurf', 'kiro', 'sublime', 'zed'];
  const cmd = quoteCommand(editor.command);
  return waits.includes(editor.id) ? `${cmd} --wait` : cmd;
}

function buildDiffToolCommand(tool: GitToolInfo): string | null {
  const waits = ['vscode', 'cursor', 'windsurf', 'kiro', 'sublime', 'zed'];
  const cmd = quoteCommand(tool.command);
  if (waits.includes(tool.id)) return `${cmd} --wait --diff "$LOCAL" "$REMOTE"`;
  if (tool.id === 'opendiff') return 'opendiff "$LOCAL" "$REMOTE"';
  return null;
}

function buildMergeToolCommand(tool: GitToolInfo): string | null {
  const waits = ['vscode', 'cursor', 'windsurf', 'kiro', 'sublime', 'zed'];
  const cmd = quoteCommand(tool.command);
  if (waits.includes(tool.id)) return `${cmd} --wait "$MERGED"`;
  if (tool.id === 'opendiff') return 'opendiff "$LOCAL" "$REMOTE" -merge "$MERGED"';
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onToast: (msg: string, variant?: ToastData['variant']) => void;
  githubAuth: GitHubAuthStatus | null;
}

export function GitSection({ onToast, githubAuth }: Props) {
  const [editors, setEditors] = useState<EditorInfo[]>([]);
  const [gitTools, setGitTools] = useState<GitToolInfo[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);

  const [currentEditor, setCurrentEditor] = useState('');
  const [customEditor, setCustomEditor] = useState('');
  const [currentDiffTool, setCurrentDiffTool] = useState('');
  const [customDiffTool, setCustomDiffTool] = useState('');
  const [currentMergeTool, setCurrentMergeTool] = useState('');
  const [customMergeTool, setCustomMergeTool] = useState('');
  const [currentGitName, setCurrentGitName] = useState('');
  const [currentGitEmail, setCurrentGitEmail] = useState('');
  const [customGitName, setCustomGitName] = useState('');
  const [customGitEmail, setCustomGitEmail] = useState('');

  const [githubEmailSuggestions, setGithubEmailSuggestions] = useState<GitHubEmailSuggestion[]>([]);
  const [githubEmailsLoading, setGithubEmailsLoading] = useState(false);

  const [editingAuthor, setEditingAuthor] = useState(false);

  // Load git config and tools on mount
  useEffect(() => {
    void Promise.all([
      api.detectEditors(),
      api.detectGitTools(),
      api.getGitConfig('core.editor'),
      api.getGitConfig('diff.tool'),
      api.getGitConfig('merge.tool'),
      api.getGitConfig('user.name'),
      api.getGitConfig('user.email'),
    ]).then(([detectedEditors, detectedTools, configEditor, diffTool, mergeTool, gitName, gitEmail]) => {
      setEditors(detectedEditors);
      setGitTools(detectedTools);
      setCurrentEditor(configEditor ?? '');
      setCurrentDiffTool(diffTool ?? '');
      setCurrentMergeTool(mergeTool ?? '');
      setCurrentGitName(gitName ?? '');
      setCurrentGitEmail(gitEmail ?? '');
      setCustomGitName(gitName ?? '');
      setCustomGitEmail(gitEmail ?? '');
      if (configEditor && !detectedEditors.some((e: EditorInfo) => e.installed && matchesEditor(e, configEditor))) {
        setCustomEditor(configEditor);
      }
    }).finally(() => setToolsLoading(false));
  }, []);

  // Load GitHub email suggestions when auth status becomes known
  useEffect(() => {
    if (!githubAuth?.authenticated) { setGithubEmailSuggestions([]); return; }
    setGithubEmailsLoading(true);
    void api.githubListEmails()
      .then((emails: GitHubEmailSuggestion[]) => setGithubEmailSuggestions(emails))
      .catch(() => setGithubEmailSuggestions([]))
      .finally(() => setGithubEmailsLoading(false));
  }, [githubAuth?.authenticated]);

  // ── Derived ───────────────────────────────────────────────────────────

  const installedEditors = editors.filter(e => e.installed);
  const unavailableEditors = editors.filter(e => !e.installed);
  const installedDiffTools = gitTools.filter(t => t.installed && t.supportsDiff);
  const installedMergeTools = gitTools.filter(t => t.installed && t.supportsMerge);

  const editorDisplay = (() => {
    if (!currentEditor.trim()) return null;
    const match = editors.find(e => matchesEditor(e, currentEditor));
    if (match) return { id: match.id, name: match.name };
    return fallbackDisplay(currentEditor);
  })();

  const diffToolDisplay = (() => {
    if (!currentDiffTool.trim()) return null;
    const token = commandToken(currentDiffTool);
    const match = gitTools.find(t => t.id === currentDiffTool || t.id === token);
    if (match) return { id: match.id, name: match.name };
    return fallbackDisplay(currentDiffTool);
  })();

  const mergeToolDisplay = (() => {
    if (!currentMergeTool.trim()) return null;
    const token = commandToken(currentMergeTool);
    const match = gitTools.find(t => t.id === currentMergeTool || t.id === token);
    if (match) return { id: match.id, name: match.name };
    return fallbackDisplay(currentMergeTool);
  })();

  // ── Test command resolution ─────────────────────────────────────────
  // `diff.tool`/`merge.tool` in git config is just a tool id (e.g. "vscode")
  // for detected presets — the actual invocable command lives in
  // `difftool.<id>.cmd` / `mergetool.<id>.cmd`. A custom (non-preset) value
  // is already a full command and is used as-is.

  async function resolveDiffToolTestCommand(): Promise<string> {
    const value = currentDiffTool.trim();
    if (!value) return '';
    const cmd = await api.getGitConfig(`difftool.${value}.cmd`);
    return cmd?.trim() || value;
  }

  async function resolveMergeToolTestCommand(): Promise<string> {
    const value = currentMergeTool.trim();
    if (!value) return '';
    const cmd = await api.getGitConfig(`mergetool.${value}.cmd`);
    return cmd?.trim() || value;
  }

  // ── Actions ───────────────────────────────────────────────────────────

  async function saveGitIdentity() {
    try {
      await Promise.all([
        api.setGitConfig('user.name', customGitName.trim()),
        api.setGitConfig('user.email', customGitEmail.trim()),
      ]);
      setCurrentGitName(customGitName.trim());
      setCurrentGitEmail(customGitEmail.trim());
      setEditingAuthor(false);
      onToast('Git author updated', 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  async function applyGithubEmail(s: GitHubEmailSuggestion) {
    try {
      await api.setGitConfig('user.email', s.email);
      setCurrentGitEmail(s.email);
      setCustomGitEmail(s.email);
      onToast(`Git email set to ${s.label}`, 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  async function applyGithubUsernameAsAuthor() {
    if (!githubAuth?.username) return;
    try {
      await api.setGitConfig('user.name', githubAuth.username);
      setCurrentGitName(githubAuth.username);
      setCustomGitName(githubAuth.username);
      onToast('Git author name set from GitHub username', 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  async function selectEditor(editor: EditorInfo) {
    try {
      const cmd = editorCommand(editor);
      await api.setGitConfig('core.editor', cmd);
      setCurrentEditor(cmd);
      setCustomEditor('');
      onToast(`Editor set to ${editor.name}`, 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  async function saveCustomEditor() {
    try {
      const value = customEditor.trim();
      await api.setGitConfig('core.editor', value);
      setCurrentEditor(value);
      onToast(value ? `Editor set to "${value}"` : 'Editor config cleared', 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  async function applyDetectedDiffTool(tool: GitToolInfo) {
    try {
      await api.setGitConfig('diff.tool', tool.id);
      const cmd = buildDiffToolCommand(tool);
      if (cmd) await api.setGitConfig(`difftool.${tool.id}.cmd`, cmd);
      setCurrentDiffTool(tool.id);
      setCustomDiffTool('');
      onToast(`Diff tool set to ${tool.name}`, 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  async function saveCustomDiffTool() {
    try {
      await api.setGitConfig('diff.tool', customDiffTool.trim());
      setCurrentDiffTool(customDiffTool.trim());
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  async function applyDetectedMergeTool(tool: GitToolInfo) {
    try {
      await api.setGitConfig('merge.tool', tool.id);
      const cmd = buildMergeToolCommand(tool);
      if (cmd) await api.setGitConfig(`mergetool.${tool.id}.cmd`, cmd);
      setCurrentMergeTool(tool.id);
      setCustomMergeTool('');
      onToast(`Merge tool set to ${tool.name}`, 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  async function saveCustomMergeTool() {
    try {
      await api.setGitConfig('merge.tool', customMergeTool.trim());
      setCurrentMergeTool(customMergeTool.trim());
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface)">
      <div className="border-b border-(--sg-border) px-5 py-4">
        <h2 className="sg-heading text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
          <GitBranch size={15} /> Git Settings
        </h2>
        <p className="mt-1 text-xs text-(--sg-text-faint)">These update your global Git configuration.</p>
      </div>

      {toolsLoading ? (
        <div className="px-5 py-5 text-xs text-(--sg-text-dim) flex items-center gap-2">
          <Spinner size="sm" /> Detecting editors and tools...
        </div>
      ) : (
        <div className="divide-y divide-(--sg-border)">
          {/* Author identity */}
          <div className="px-5 py-4">
            <div className="flex items-start justify-between">
              <div className="flex gap-2.5">
                <div className="mt-0.5 shrink-0 text-(--sg-text-faint)"><User size={13} /></div>
                <div>
                  <p className="sg-heading text-xs font-semibold text-(--sg-text)">Author Identity</p>
                  <p className="text-[11px] text-(--sg-text-faint)">
                    {currentGitName || '(not set)'} · {currentGitEmail || '(not set)'}
                  </p>
                </div>
              </div>
              <button
                className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim)"
                onClick={() => setEditingAuthor(v => !v)}
              >
                {editingAuthor ? 'Done' : <><Pencil size={12} /> Edit</>}
              </button>
            </div>
            {editingAuthor && (
              <div className="mt-3 space-y-2 border-t border-(--sg-border) pt-3">
                <input
                  value={customGitName}
                  onChange={e => setCustomGitName(e.target.value)}
                  className="w-full rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 text-xs text-(--sg-text)"
                  placeholder="Git user.name"
                />
                <input
                  value={customGitEmail}
                  onChange={e => setCustomGitEmail(e.target.value)}
                  className="w-full rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 text-xs text-(--sg-text)"
                  placeholder="Git user.email"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text)"
                    onClick={() => void saveGitIdentity()}
                  >
                    Save Author
                  </button>
                  {githubAuth?.authenticated && githubAuth.username && (
                    <button
                      className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text)"
                      onClick={() => void applyGithubUsernameAsAuthor()}
                    >
                      Use GitHub Username
                    </button>
                  )}
                </div>
                {githubAuth?.authenticated && (
                  <div className="flex flex-wrap gap-2">
                    {githubEmailsLoading ? (
                      <span className="text-[11px] text-(--sg-text-faint)">Loading GitHub emails...</span>
                    ) : githubEmailSuggestions.map(s => (
                      <button
                        key={s.email}
                        className="rounded border border-(--sg-border) px-2 py-1 text-[11px] text-(--sg-text-dim)"
                        onClick={() => void applyGithubEmail(s)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Editor */}
          <SettingsToolRow
            testId="editor-row"
            icon={<Code2 size={13} />}
            title="Editor"
            currentValueLabel={editorDisplay?.name ?? '(not set)'}
            presets={installedEditors.map(e => ({ id: e.id, name: e.name, active: !!currentEditor && matchesEditor(e, currentEditor) }))}
            onSelectPreset={id => {
              const editor = installedEditors.find(e => e.id === id);
              if (editor) void selectEditor(editor);
            }}
            customValue={customEditor}
            onCustomValueChange={setCustomEditor}
            customPlaceholder="Custom core.editor"
            onSaveCustom={saveCustomEditor}
            onTest={() => api.testEditor(currentEditor)}
            editExtra={unavailableEditors.length > 0 ? (
              <p className="text-[11px] text-(--sg-text-faint)">
                Not found: {unavailableEditors.map(e => e.name).join(', ')}
              </p>
            ) : undefined}
          />

          {/* Diff tool */}
          <SettingsToolRow
            testId="diff-tool-row"
            icon={<Diff size={13} />}
            title="Diff Tool"
            currentValueLabel={diffToolDisplay?.name ?? '(not set)'}
            presets={installedDiffTools.map(t => ({ id: t.id, name: t.name, active: currentDiffTool === t.id }))}
            onSelectPreset={id => {
              const tool = installedDiffTools.find(t => t.id === id);
              if (tool) void applyDetectedDiffTool(tool);
            }}
            customValue={customDiffTool}
            onCustomValueChange={setCustomDiffTool}
            customPlaceholder="Custom diff.tool"
            onSaveCustom={saveCustomDiffTool}
            onTest={async () => api.testDiffTool(await resolveDiffToolTestCommand())}
          />

          {/* Merge tool */}
          <SettingsToolRow
            testId="merge-tool-row"
            icon={<GitMerge size={13} />}
            title="Merge Tool"
            currentValueLabel={mergeToolDisplay?.name ?? '(not set)'}
            presets={installedMergeTools.map(t => ({ id: t.id, name: t.name, active: currentMergeTool === t.id }))}
            onSelectPreset={id => {
              const tool = installedMergeTools.find(t => t.id === id);
              if (tool) void applyDetectedMergeTool(tool);
            }}
            customValue={customMergeTool}
            onCustomValueChange={setCustomMergeTool}
            customPlaceholder="Custom merge.tool"
            onSaveCustom={saveCustomMergeTool}
            onTest={async () => api.testMergeTool(await resolveMergeToolTestCommand())}
          />
        </div>
      )}
    </section>
  );
}
