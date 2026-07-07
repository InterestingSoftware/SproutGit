/**
 * Coding-agent IPC handlers.
 *
 * There is a single configured AI agent (command + args + invocation mode),
 * same shape as the editor/diff-tool/merge-tool settings rows — not a roster.
 * "Terminal" mode launches it as a PTY session in a worktree, the same way
 * hooks are launched. "Integrated" mode (Claude Code only, for now) is
 * handled separately by chat.ts, which spawns the agent with structured
 * streaming output and renders it in the Chat tab.
 */
import { BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { IPC, ACP_PRESET_TOKENS } from '@sproutgit/types';
import type { AcpAdapterStatus, AgentConfig, IssueTrackerPattern, ToolTestResult } from '@sproutgit/types';
import { openWorkspaceDb, eq, getAgentConfig, saveAgentConfig, type ConfigDb } from '@sproutgit/database';
import { worktreeMetadata } from '@sproutgit/database/schema/workspace';
import { readIssueTrackerFile } from '@sproutgit/git';
import { join, basename } from 'path';
import { manager, sessionWindows } from './terminal.js';
import { attentionTracker } from './session-attention.js';
import { handle } from './handle.js';
import { resolveCommandPath, truncate, okResult, errResult } from './tool-test-helpers.js';
import { installAcpAdapter, resolveAcpAdapterBin } from './acp-adapters.js';
import { workspaceDbPath } from './workspace.js';

function getWorkspaceDb(workspacePath: string) {
  return openWorkspaceDb(workspaceDbPath(workspacePath));
}

/**
 * Resolves a stored issue ref back to a URL via the repo's `.issuetracker`
 * patterns. Purely local (reads a file, no network) — agent launch must
 * never block on or fail due to a live provider fetch.
 */
function resolveIssueUrl(issueRef: string, patterns: IssueTrackerPattern[]): string {
  for (const pattern of patterns) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern.regex);
    } catch {
      continue;
    }
    const match = regex.exec(issueRef);
    if (!match) continue;
    return pattern.url.replace(/\$(\d+)/g, (_, groupIdx: string) => match[Number(groupIdx)] ?? '');
  }
  return '';
}

/** The resolved argv to spawn a configured agent in Agent Client Protocol (ACP) mode. */
type AcpLaunchSpec = { bin: string; args: string[] };

interface AcpPreset {
  /** Matches against the lowercased basename of the configured command. */
  match(token: string): boolean;
  label: string;
  /**
   * npm package providing the ACP adapter binary, for presets whose ACP
   * support ships as a separate adapter rather than a flag on the CLI
   * itself — surfaced in the "binary not found" error so the user knows
   * what to install.
   */
  npmPackage?: string;
  /** Rough download size of npmPackage's platform binary, for install-confirmation copy. */
  approxSizeMb?: number;
  /** Builds the argv to spawn in ACP mode from the user's configured command. */
  build(ctx: { configuredBin: string; configuredArgs: string[] }): AcpLaunchSpec;
}

/**
 * Per-preset ACP invocation table, verified against each CLI's own docs:
 *
 * - Claude Code: the `claude` CLI has no built-in ACP mode. The official
 *   adapter is the separate `@agentclientprotocol/claude-agent-acp` package
 *   (bin `claude-agent-acp`), which speaks ACP using the Claude Agent SDK
 *   directly — it does not shell out to `claude` itself, so the user's
 *   configured command/args are irrelevant to it.
 * - Gemini CLI: native support via the `--acp` flag
 *   (`--experimental-acp` is a deprecated alias for the same flag).
 * - Codex CLI: like Claude, has no built-in ACP mode. The official adapter
 *   is `@agentclientprotocol/codex-acp` (bin `codex-acp`), a standalone
 *   binary that bundles its own Codex runtime.
 * - Kiro CLI: native support via the `acp` subcommand (`kiro-cli acp`).
 * - Cursor CLI: native support via the `acp` subcommand (`cursor-agent acp`).
 */
const ACP_PRESETS: readonly AcpPreset[] = [
  {
    match: token => (ACP_PRESET_TOKENS.claudeCode as readonly string[]).includes(token),
    label: 'Claude Code',
    npmPackage: '@agentclientprotocol/claude-agent-acp',
    // The adapter's platform optionalDependency is a self-contained,
    // compiled Claude Code binary (not a thin wrapper) — hence the size.
    approxSizeMb: 220,
    build: () => ({ bin: 'claude-agent-acp', args: [] }),
  },
  {
    match: token => (ACP_PRESET_TOKENS.gemini as readonly string[]).includes(token),
    label: 'Gemini CLI',
    build: ({ configuredBin, configuredArgs }) => ({ bin: configuredBin, args: [...configuredArgs, '--acp'] }),
  },
  {
    match: token => (ACP_PRESET_TOKENS.codex as readonly string[]).includes(token),
    label: 'Codex CLI',
    npmPackage: '@agentclientprotocol/codex-acp',
    // Same story as Claude's adapter: bundles a full compiled Codex binary.
    approxSizeMb: 245,
    build: () => ({ bin: 'codex-acp', args: [] }),
  },
  {
    match: token => (ACP_PRESET_TOKENS.kiro as readonly string[]).includes(token),
    label: 'Kiro CLI',
    build: ({ configuredBin, configuredArgs }) => ({ bin: configuredBin, args: [...configuredArgs, 'acp'] }),
  },
  {
    match: token => (ACP_PRESET_TOKENS.cursor as readonly string[]).includes(token),
    label: 'Cursor CLI',
    build: ({ configuredBin, configuredArgs }) => ({ bin: configuredBin, args: [...configuredArgs, 'acp'] }),
  },
];

/**
 * `command` is always just the binary (args live separately in
 * `AgentConfig.args`), so this takes the path's basename directly rather
 * than running it through splitCommand()'s general tokenizer — which would
 * incorrectly split an unquoted absolute path containing spaces (common on
 * Windows) at the first space instead of treating it as one atomic value.
 */
function commandToken(command: string): string {
  const trimmed = command.trim().replace(/^["']|["']$/g, '');
  return trimmed.split(/[\\/]/).pop()?.toLowerCase() ?? '';
}

function findAcpPreset(command: string): AcpPreset | undefined {
  const token = commandToken(command);
  return ACP_PRESETS.find(p => p.match(token));
}

/** Whether `npmPackage` is one of the ACP adapter packages this app actually knows about — guards AGENT_ACP_ADAPTER_INSTALL against installing an arbitrary renderer-supplied package name. */
function isKnownAcpAdapterPackage(npmPackage: string): boolean {
  return ACP_PRESETS.some(p => p.npmPackage === npmPackage);
}

/** Whether `command` resolves to Claude Code's own CLI — the only one known to support `-p`/`--print` non-interactive mode. */
function commandIsClaudeCli(command: string): boolean {
  const token = commandToken(command);
  return token === 'claude' || token === 'claude-code';
}

/** Recognizes commands that support Agent Client Protocol (ACP) mode ("Integrated" mode). */
export function commandSupportsIntegratedMode(command: string): boolean {
  return findAcpPreset(command) !== undefined;
}

/**
 * Resolves the argv to spawn for the configured agent's ACP mode, or `null`
 * if it isn't recognized. For CLIs with native ACP support this augments
 * the user's configured command/args with the right flag or subcommand; for
 * agents whose ACP support ships as a separate adapter package, this
 * ignores the configured command entirely and returns that adapter's own
 * binary name (still subject to PATH resolution by the caller).
 */
export type AcpPresetInfo = AcpLaunchSpec & { label: string; npmPackage?: string; approxSizeMb?: number };

export function getAcpLaunchSpec(command: string, args: string[]): AcpPresetInfo | null {
  const preset = findAcpPreset(command);
  if (!preset) return null;
  // `command` is always just the binary (args live separately in `args`) —
  // just strip a wrapping quote pair rather than running it through
  // splitCommand()'s general tokenizer, which would incorrectly split an
  // unquoted absolute path containing spaces (common on Windows).
  const configuredBin = command.trim().replace(/^["']|["']$/g, '');
  const launch = preset.build({ configuredBin, configuredArgs: args });
  const info: AcpPresetInfo = { ...launch, label: preset.label };
  if (preset.npmPackage) info.npmPackage = preset.npmPackage;
  if (preset.approxSizeMb) info.approxSizeMb = preset.approxSizeMb;
  return info;
}

async function buildAgentEnv(args: { workspacePath: string; worktreePath: string }): Promise<Record<string, string>> {
  const db = getWorkspaceDb(args.workspacePath);
  const wtMeta = db
    .select()
    .from(worktreeMetadata)
    .where(eq(worktreeMetadata.worktreePath, args.worktreePath))
    .get();
  db.close();

  const osName = process.platform === 'darwin' ? 'macos'
    : process.platform === 'win32' ? 'windows'
    : 'linux';

  const issuePatterns = await readIssueTrackerFile(args.worktreePath);
  const issueRef = wtMeta?.issueRef ?? '';

  return {
    SPROUTGIT_WORKSPACE: args.workspacePath,
    SPROUTGIT_WORKSPACE_NAME: basename(args.workspacePath),
    SPROUTGIT_ROOT_PATH: join(args.workspacePath, '.sproutgit', 'root'),
    SPROUTGIT_WORKTREES_PATH: join(args.workspacePath, '.sproutgit', 'worktrees'),
    SPROUTGIT_WORKTREE: args.worktreePath,
    SPROUTGIT_WORKTREE_NAME: basename(args.worktreePath),
    SPROUTGIT_WORKTREE_BRANCH: wtMeta?.branch ?? '',
    SPROUTGIT_SOURCE_REF: wtMeta?.sourceRef ?? '',
    SPROUTGIT_OS: osName,
    // Fixed value now that there's a single configured agent rather than a
    // roster of named agents with distinct ids — kept for scripts/hooks that
    // already key off this var to detect an agent-launched session.
    SPROUTGIT_AGENT: 'agent',
    SPROUTGIT_ISSUE_REF: issueRef,
    SPROUTGIT_ISSUE_URL: issueRef ? resolveIssueUrl(issueRef, issuePatterns) : '',
    SPROUTGIT_ISSUE_TITLE: wtMeta?.issueTitle ?? '',
  };
}

export function registerAgentHandlers(configDb: ConfigDb, userDataPath: string): void {
  handle(IPC.AGENT_GET, () => getAgentConfig(configDb));

  handle(IPC.AGENT_SAVE, (_e, config: AgentConfig) => {
    saveAgentConfig(configDb, config);
  });

  // ── ACP adapter install (Claude Code / Codex CLI) ───────────────────────
  handle(IPC.AGENT_ACP_ADAPTER_STATUS, async (): Promise<AcpAdapterStatus | null> => {
    const agent = getAgentConfig(configDb);
    const spec = getAcpLaunchSpec(agent.command, agent.args);
    if (!spec?.npmPackage) return null;
    const [resolved, npmBin] = await Promise.all([
      resolveAcpAdapterBin(userDataPath, spec),
      resolveCommandPath('npm'),
    ]);
    return {
      npmPackage: spec.npmPackage,
      label: spec.label,
      bin: spec.bin,
      installed: resolved !== null,
      approxSizeMb: spec.approxSizeMb ?? 0,
      npmAvailable: npmBin !== null,
    };
  });

  handle(IPC.AGENT_ACP_ADAPTER_INSTALL, async (_e, npmPackage: string) => {
    if (!isKnownAcpAdapterPackage(npmPackage)) {
      throw new Error(`Refusing to install unrecognized package "${npmPackage}".`);
    }
    const win = BrowserWindow.fromWebContents(_e.sender);
    await installAcpAdapter(userDataPath, npmPackage, event => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.EVENT_AGENT_ACP_ADAPTER_INSTALL, event);
    });
  });

  handle(IPC.AGENT_LAUNCH, async (_e, args: {
    workspacePath: string;
    worktreePath: string;
  }) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (!win) throw new Error('No active window to launch the agent in.');

    const agent = getAgentConfig(configDb);
    if (!agent.command.trim()) {
      throw new Error('No agent command configured. Set one in Settings → AI Agent.');
    }

    const env = await buildAgentEnv(args);

    // The agent binary is spawned directly (not through a shell). On POSIX,
    // a missing/bad command still surfaces as a normal async PTY exit. On
    // Windows, ConPTY's CreateProcess can fail synchronously instead, so we
    // catch and log here rather than letting an unhandled rejection hide
    // the real cause. resolveShell: false stops TerminalManager from
    // substituting the platform default shell for an unresolvable command,
    // which would otherwise spawn (and mislabel) a plain shell as this agent.
    let id: string;
    try {
      id = manager.spawn({
        cwd: args.worktreePath,
        shell: agent.command,
        args: agent.args,
        resolveShell: false,
        env,
        label: 'AI Agent',
        agentId: 'agent',
        agentName: commandToken(agent.command),
      });
    } catch (spawnErr) {
      const message = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      throw new Error(`Failed to launch agent (command: ${JSON.stringify(agent.command)}, args: ${JSON.stringify(agent.args)}): ${message}`, { cause: spawnErr });
    }

    sessionWindows.set(id, win);
    attentionTracker.setWorking(id, 'terminal', args.worktreePath);

    win.webContents.send(IPC.EVENT_AGENT_TERMINAL_LAUNCH, {
      terminalId: id,
      cwd: args.worktreePath,
    });

    return id;
  });

  // ── Test ──────────────────────────────────────────────────────────────
  // Actually runs the configured agent command with a small fixed real
  // prompt and confirms non-empty, non-error stdout comes back — not just
  // `<cmd> --version`. Only Claude Code's non-interactive prompt flag (-p)
  // is known; any other configured command would likely just hang waiting
  // for interactive input on a bare positional prompt, so we confirm the
  // binary resolves and stop there rather than guessing at a flag. This is
  // independent of ACP support (commandSupportsIntegratedMode) — that gates
  // the Chat tab, which spawns a different ACP-mode invocation entirely
  // (see chat.ts), not this raw `-p` smoke test.
  handle(IPC.AGENT_TEST, async (): Promise<ToolTestResult> => {
    const agent = getAgentConfig(configDb);
    // agent.command is always just the binary (args live separately in
    // agent.args) — strip a wrapping quote pair rather than running it
    // through splitCommand()'s general tokenizer, which would incorrectly
    // split an unquoted absolute path containing spaces (common on Windows).
    const bin = agent.command.trim().replace(/^["']|["']$/g, '');
    if (!bin) return errResult('', 'No agent command configured.');

    const resolved = await resolveCommandPath(bin);
    if (!resolved) return errResult(bin, `Command not found on PATH: ${bin}`);

    if (!commandIsClaudeCli(agent.command)) {
      return okResult(resolved, `Found ${resolved}. This command's non-interactive prompt flag isn't known, so a live prompt test wasn't run — only Claude Code supports that right now.`);
    }

    const prompt = 'Reply with only the word OK.';
    const testArgs = [...agent.args, '-p', prompt];
    const resolvedCommand = `${resolved} ${testArgs.join(' ')}`;

    return new Promise(resolve => {
      const child = execFile(
        resolved,
        testArgs,
        { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            resolve(errResult(resolvedCommand, error.killed ? 'Agent timed out after 15s.' : (stderr.trim() || error.message), truncate(stdout + stderr)));
            return;
          }
          const trimmed = stdout.trim();
          if (!trimmed) {
            resolve(errResult(resolvedCommand, 'Agent produced no output.', truncate(stderr)));
            return;
          }
          resolve(okResult(resolvedCommand, `Agent responded: "${truncate(trimmed, 200)}"`));
        },
      );
      child.stdin?.end();
    });
  });
}
