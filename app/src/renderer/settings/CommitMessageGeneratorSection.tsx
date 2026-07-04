import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { COMMIT_MESSAGE_GENERATOR_PRESETS, type CommitMessageGeneratorSettings } from '@sproutgit/types';
import { Spinner, type ToastData } from '@sproutgit/ui';
import { loadCommitMessageGeneratorSettings, saveCommitMessageGeneratorSettings } from '../commit-message-generator-settings.js';

interface Props {
  onToast: (msg: string, variant?: ToastData['variant']) => void;
}

export function CommitMessageGeneratorSection({ onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [presetId, setPresetId] = useState('custom');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');

  useEffect(() => {
    void loadCommitMessageGeneratorSettings().then(settings => {
      setPresetId(settings.presetId);
      setCommand(settings.command);
      setArgsText(settings.args.join('\n'));
    }).catch((err: unknown) => onToast(`Failed to load commit message generator settings: ${String(err)}`, 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectPreset(id: string) {
    const preset = COMMIT_MESSAGE_GENERATOR_PRESETS.find(p => p.id === id);
    if (!preset) return;
    setPresetId(preset.id);
    setCommand(preset.command);
    setArgsText(preset.args.join('\n'));
  }

  async function save() {
    const settings: CommitMessageGeneratorSettings = {
      presetId,
      command: command.trim(),
      args: argsText.split('\n').map(a => a.trim()).filter(Boolean),
    };
    try {
      await saveCommitMessageGeneratorSettings(settings);
      onToast('Commit message generator saved', 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface)">
      <div className="border-b border-(--sg-border) px-5 py-4">
        <h2 className="sg-heading text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
          <Sparkles size={15} /> AI Commit Messages
        </h2>
        <p className="mt-1 text-xs text-(--sg-text-faint)">
          Generates a commit message from the staged diff using a command-line agent of your choice.
        </p>
      </div>

      {loading ? (
        <div className="px-5 py-5 text-xs text-(--sg-text-dim) flex items-center gap-2">
          <Spinner size="sm" /> Loading...
        </div>
      ) : (
        <div className="px-5 py-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {COMMIT_MESSAGE_GENERATOR_PRESETS.map(preset => (
              <button
                key={preset.id}
                className={`rounded border px-3 py-1.5 text-xs ${presetId === preset.id ? 'border-(--sg-primary) text-(--sg-primary)' : 'border-(--sg-border) text-(--sg-text-dim)'}`}
                onClick={() => selectPreset(preset.id)}
              >
                {preset.name}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-(--sg-text-faint)">Command</label>
            <input
              value={command}
              onChange={e => setCommand(e.target.value)}
              className="w-full rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 font-mono text-xs text-(--sg-text)"
              placeholder="e.g. claude"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-(--sg-text-faint)">Arguments (one per line)</label>
            <textarea
              value={argsText}
              onChange={e => setArgsText(e.target.value)}
              rows={4}
              className="w-full resize-none rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 font-mono text-xs text-(--sg-text)"
              placeholder={'-p\nWrite a commit message for this staged diff...'}
            />
          </div>

          <button
            className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text)"
            onClick={() => void save()}
          >
            Save
          </button>

          <div className="border-t border-(--sg-border) pt-3 text-[11px] text-(--sg-text-faint) space-y-1">
            <p className="font-semibold text-(--sg-text-dim)">How it runs</p>
            <p>The staged diff is written to the command&apos;s stdin. The command must print the commit message (subject + optional body) to stdout — a non-zero exit code or empty stdout is treated as a failure.</p>
            <p>
              Available env vars: <code>SPROUTGIT_WORKSPACE</code>, <code>SPROUTGIT_WORKSPACE_NAME</code>, <code>SPROUTGIT_ROOT_PATH</code>,{' '}
              <code>SPROUTGIT_WORKTREES_PATH</code>, <code>SPROUTGIT_WORKTREE</code>, <code>SPROUTGIT_WORKTREE_NAME</code>, <code>SPROUTGIT_OS</code>, and{' '}
              <code>SPROUTGIT_RECENT_COMMITS</code> (the last 10 commit subjects, newline-separated — useful as a style reference). Reference them in an
              argument as <code>$SPROUTGIT_RECENT_COMMITS</code>; SproutGit substitutes the value directly (no shell is involved).
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
