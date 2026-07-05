import { Sparkles } from "lucide-react";
import { api } from "../api.js";
import { useEffect, useState } from "react";
import {
  COMMIT_MESSAGE_GENERATOR_PRESETS,
  type CommitMessageGeneratorSettings,
} from "@sproutgit/types";
import { Spinner, type ToastData } from "@sproutgit/ui";
import {
  loadCommitMessageGeneratorSettings,
  saveCommitMessageGeneratorSettings,
} from "../commit-message-generator-settings.js";
import { SettingsToolRow, type ToolPreset } from "./SettingsToolRow.js";

interface Props {
  onToast: (msg: string, variant?: ToastData["variant"]) => void;
}

function commandLabel(settings: CommitMessageGeneratorSettings): string {
  if (!settings.command.trim()) return "(not set)";
  const preset = COMMIT_MESSAGE_GENERATOR_PRESETS.find(
    (p) => p.id === settings.presetId,
  );
  return preset && preset.id !== "custom" ? preset.name : settings.command;
}

export function CommitMessageGeneratorSection({ onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [presetId, setPresetId] = useState("custom");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");

  useEffect(() => {
    void loadCommitMessageGeneratorSettings()
      .then((settings) => {
        setPresetId(settings.presetId);
        setCommand(settings.command);
        setArgsText(settings.args.join("\n"));
      })
      .catch((err: unknown) =>
        onToast(
          `Failed to load commit message generator settings: ${String(err)}`,
          "error",
        ),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function currentSettings(): CommitMessageGeneratorSettings {
    return {
      presetId,
      command: command.trim(),
      args: argsText
        .split("\n")
        .map((a) => a.trim())
        .filter(Boolean),
    };
  }

  function selectPreset(id: string) {
    const preset = COMMIT_MESSAGE_GENERATOR_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(preset.id);
    setCommand(preset.command);
    setArgsText(preset.args.join("\n"));
    void save({
      presetId: preset.id,
      command: preset.command,
      args: preset.args,
    });
  }

  async function save(
    settings: CommitMessageGeneratorSettings = currentSettings(),
  ) {
    try {
      await saveCommitMessageGeneratorSettings(settings);
      onToast("Commit message generator saved", "success");
    } catch (err) {
      onToast(String(err), "error");
    }
  }

  const presets: ToolPreset[] = COMMIT_MESSAGE_GENERATOR_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    active: presetId === p.id,
  }));

  if (loading) {
    return (
      <div
        className="px-5 py-5 text-xs text-(--sg-text-dim) flex items-center gap-2"
        data-testid="commitmsg-section"
      >
        <Spinner size="sm" /> Loading...
      </div>
    );
  }

  return (
    <div data-testid="commitmsg-section">
      <SettingsToolRow
        testId="commitmsg-row"
        icon={<Sparkles size={13} />}
        title="AI Commit Messages"
        currentValueLabel={commandLabel(currentSettings())}
        presets={presets}
        onSelectPreset={selectPreset}
        // Command only -- args (which can contain multi-word prompt text
        // with internal spaces) are edited exclusively via the one-per-line
        // textarea below. Joining command+args into one line and
        // re-splitting on whitespace would silently shred any arg
        // containing a space, e.g. the preset prompt text itself.
        customValue={command}
        onCustomValueChange={(value) => {
          setPresetId("custom");
          setCommand(value);
        }}
        customPlaceholder="e.g. claude"
        onSaveCustom={() => save()}
        onTest={() => api.testCommitMessageGenerator(currentSettings())}
        onToast={onToast}
        editExtra={
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-(--sg-text-faint)">
              Arguments (one per line, for fine control)
            </label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={4}
              className="w-full resize-none rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 font-mono text-xs text-(--sg-text)"
              placeholder={"-p\nWrite a commit message for this staged diff..."}
            />
            <button
              type="button"
              className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text) cursor-pointer bg-transparent"
              onClick={() => void save()}
            >
              Save Arguments
            </button>
          </div>
        }
      />

      <div className="border-t border-(--sg-border) px-5 py-3 text-[11px] text-(--sg-text-faint) space-y-1">
        <p className="font-semibold text-(--sg-text-dim)">How it runs</p>
        <p>
          The staged diff is written to the command&apos;s stdin. The command
          must print the commit message (subject + optional body) to stdout — a
          non-zero exit code or empty stdout is treated as a failure.
        </p>
        <p>
          Available env vars: <code>SPROUTGIT_WORKSPACE</code>,{" "}
          <code>SPROUTGIT_WORKSPACE_NAME</code>,{" "}
          <code>SPROUTGIT_ROOT_PATH</code>,{" "}
          <code>SPROUTGIT_WORKTREES_PATH</code>, <code>SPROUTGIT_WORKTREE</code>
          , <code>SPROUTGIT_WORKTREE_NAME</code>, <code>SPROUTGIT_OS</code>, and{" "}
          <code>SPROUTGIT_RECENT_COMMITS</code> (the last 10 commit subjects,
          newline-separated — useful as a style reference). Reference them in an
          argument as <code>$SPROUTGIT_RECENT_COMMITS</code>; SproutGit
          substitutes the value directly (no shell is involved).
        </p>
      </div>
    </div>
  );
}
