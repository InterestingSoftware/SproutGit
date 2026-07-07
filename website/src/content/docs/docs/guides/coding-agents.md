---
title: Setting up a coding agent
description: Configure Claude Code, Kiro, Cursor, Codex CLI, Gemini CLI, or any custom CLI as your AI coding agent.
---

SproutGit configures a single AI coding agent at a time — one command, its
arguments, and an invocation mode — in **Settings → AI → AI Agent**. Once
set, you can launch it into any worktree.

## Pick a preset

The AI Agent row offers one-click presets for the CLIs SproutGit knows
about:

| Preset | Command |
|---|---|
| Claude Code | `claude` |
| Kiro | `kiro` |
| Cursor | `cursor-agent` |
| Codex CLI | `codex` |
| Gemini CLI | `gemini` |

Clicking a preset fills in its command and saves immediately. Each of these
must already be installed and on your `PATH` — SproutGit spawns the command
directly, it doesn't install the CLI for you.

## Custom command

Not using one of the above, or want to pass extra flags? Type a command
(and any arguments) directly into the custom field instead of picking a
preset — anything you'd type at a shell prompt to start the agent works,
e.g. `claude --model opus` or a wrapper script of your own. Whatever you
type is saved as the binary plus its argument list.

## Terminal vs. Integrated mode

Every configured agent can run in **Terminal** mode: it launches as a raw
PTY session in a Terminal tab, scoped to whichever worktree you launched it
from. This works for any CLI, since it's just running a command in a
terminal.

**Integrated** mode instead streams the agent's structured output into a
dedicated **Chat** tab. It's only available for commands SproutGit
recognizes as speaking the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP) — currently
Claude Code, Gemini CLI, Codex CLI, Kiro, and Cursor. The mode toggle in the
Agent row is disabled for any other command.

Two of those CLIs speak ACP natively via a flag or subcommand
(`gemini --acp`, `kiro-cli acp`, `cursor-agent acp`) and need nothing extra.
Claude Code and Codex CLI need a small separate adapter package, since
neither has a built-in ACP mode:

- Claude Code → `@agentclientprotocol/claude-agent-acp` (~220MB — it bundles
  a full compiled Claude Code binary, not a thin wrapper)
- Codex CLI → `@agentclientprotocol/codex-acp` (~245MB, same story)

If Integrated mode needs an adapter that isn't installed, the Agent row
shows an **Install** button (uses `npm` on your `PATH`) or you can install
it yourself:

```sh
npm install -g @agentclientprotocol/claude-agent-acp
# or
npm install -g @agentclientprotocol/codex-acp
```

If the adapter isn't installed, saving still works — SproutGit just falls
back to Terminal mode for that agent until the adapter shows up.

## Testing your configuration

Use the **Test** action next to the Agent row to confirm SproutGit can
actually resolve and run your configured command before relying on it.

## Launching the agent

From an open workspace, launch your configured agent into any worktree
(sidebar toolbar or worktree context menu). A live-session badge marks
worktrees with an agent currently running, so it's obvious at a glance
which ones are active.

## Generating commit messages

Separately from the agent above, **Settings → AI → AI Commit Messages**
configures a command (same preset list, or your own) that SproutGit runs
against your staged diff and recent commit history to draft a commit
message — triggered by the "magic" button next to the commit message field.
