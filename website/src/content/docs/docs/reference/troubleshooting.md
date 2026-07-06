---
title: Troubleshooting
description: Common problems and how to resolve them.
---

## "Git: Not found" in Settings → About

SproutGit drives your system's Git installation rather than bundling its
own. Install Git and make sure it's on your `PATH` — see
[Installation → Prerequisite: Git](/docs/getting-started/installation/#prerequisite-git),
then restart SproutGit.

## macOS says the app is from an "unidentified developer"

Preview builds aren't notarized yet. Right-click **SproutGit.app** and
choose **Open** once — macOS remembers your choice after that. This warning
comes from Gatekeeper, not from anything wrong with the download.

## Windows SmartScreen blocks the installer

Same cause as above — the installer isn't yet signed with an EV
certificate recognized by SmartScreen. Choose **More info → Run anyway**.

## Import fails with "it has uncommitted changes" or "HEAD is detached"

[Importing a repo in place](/docs/getting-started/first-workspace/#import-git-repo)
converts your existing `.git` directory into a bare repository, which only
works from a clean state:

- **"Cannot convert … it has uncommitted changes. Commit or stash them
  first."** — commit or stash your changes, then retry.
- **"Cannot convert … HEAD is detached. Check out a branch first."** — run
  `git checkout <branch>` in the source repo, then retry.

If you'd rather not touch the source repo at all, use **Move to new
workspace** or **Copy to new workspace** instead of **Import in place** —
both work the same way but leave the conversion detail to a copy, not your
existing checkout.

## MCP server won't start — "Port X is already in use"

Something else on your machine is already bound to that port. Open
**Settings → MCP Server** and either change the port or click **Reset to
default** to get a freshly derived one, then re-enable. See
[Using the MCP server](/docs/guides/mcp-server/) for how the default port
is chosen.

## A repo hook isn't running

Repo-shipped hooks (from a worktree's `sproutgit.hooks.json`) don't run
until you explicitly trust them, even if they're enabled — this is
intentional, see
[Hooks & the trust model](/docs/concepts/hooks-and-trust/#why-repo-hooks-need-trust).
Open **Workspace Hooks**, find the hook (marked with a "repo" badge and
lock icon), and trust it. If you previously trusted it and it stopped
running after a `git pull`, someone changed the hook's script — trust is
keyed to the hook's content, so an edited hook needs to be re-trusted.

## "Integrated" mode is greyed out for my agent

Integrated mode (structured output in the Chat tab) only works for commands
SproutGit recognizes as ACP-capable — Claude Code, Gemini CLI, Codex CLI,
Kiro, and Cursor. Anything else can still run in **Terminal** mode, which
works for any CLI. See
[Setting up a coding agent](/docs/guides/coding-agents/#terminal-vs-integrated-mode).

## Integrated mode says an adapter needs installing

Claude Code and Codex CLI need a separate ACP adapter package before
Integrated mode works for them. Click **Install** in the Agent row (needs
`npm` on your `PATH`), or install manually:

```sh
npm install -g @agentclientprotocol/claude-agent-acp
# or
npm install -g @agentclientprotocol/codex-acp
```

If `npm` isn't on your `PATH`, the automatic **Install** button is
unavailable — use the manual command from a terminal where `npm` works,
then click the refresh icon next to the adapter status to re-check.

## Clipboard shortcuts (Cmd+C/V/Z/X) don't work in a text field on macOS

This should not happen in a normal build — the app registers a native
macOS application menu specifically so these shortcuts work in text
inputs. If you hit this, it likely indicates a broken build or a bug;
please [open an issue](https://github.com/InterestingSoftware/SproutGit/issues)
with your OS version and SproutGit version (from **Settings → About**).

## Still stuck?

Check the app's log file for more detail before filing an issue:

| Platform | Log path |
|---|---|
| macOS | `~/Library/Logs/SproutGit/main.log` |
| Windows | `%APPDATA%\SproutGit\logs\main.log` |
| Linux | `~/.config/SproutGit/logs/main.log` |

Then [open an issue on GitHub](https://github.com/InterestingSoftware/SproutGit/issues)
with the relevant log lines, your OS/version, and steps to reproduce.
