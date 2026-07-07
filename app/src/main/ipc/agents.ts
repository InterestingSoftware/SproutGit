/**
 * Coding-agent IPC handlers.
 *
 * The user configures a roster of named agents (command + args + per-agent
 * env vars + invocation mode), not just one. "Terminal" mode launches the
 * selected agent as a PTY session in a worktree, the same way hooks are
 * launched. "Integrated" mode is handled separately by chat.ts, which spawns
 * the agent's Agent Client Protocol (ACP) invocation with structured
 * streaming output and renders it in the Chat tab — gated by each roster
 * entry's own `acp` flag rather than a hardcoded command allowlist.
 */
import { BrowserWindow } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type AgentCapabilities, type Client } from '@agentclientprotocol/sdk';
import { IPC, ACP_PRESET_TOKENS } from '@sproutgit/types';
import type { AcpAdapterStatus, AgentRosterEntry, AgentRoster, AgentTestInput, IssueTrackerPattern, ToolTestResult } from '@sproutgit/types';
import { openWorkspaceDb, eq, getAgentRoster, saveAgentRoster, resolveRosterAgent, type ConfigDb } from '@sproutgit/database';
import { worktreeMetadata } from '@sproutgit/database/schema/workspace';
import { readIssueTrackerFile } from '@sproutgit/git';
import { join, basename } from 'path';
import { manager, sessionWindows } from './terminal.js';
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

/** The resolved argv to spawn an agent in Agent Client Protocol (ACP) mode. */
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
 *
 * This table is only consulted for *recognized* commands — it remains the
 * default source of truth for the known presets' invocation quirks (a
 * separate adapter binary vs. a flag/subcommand). Ad-hoc/custom agents that
 * aren't recognized here are still allowed to assert `acp: true` themselves
 * (see `getAcpLaunchSpecForAgent`); they're just spawned as configured, with
 * no augmentation, since there's no known quirk to correct for.
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
 * `AgentRosterEntry.args`), so this takes the path's basename directly
 * rather than running it through splitCommand()'s general tokenizer — which
 * would incorrectly split an unquoted absolute path containing spaces
 * (common on Windows) at the first space instead of treating it as one
 * atomic value.
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

/** Recognizes commands matching one of the known ACP-capable presets (Claude Code, Gemini, Codex, Kiro, Cursor). Distinct from a roster entry's own `acp` flag — a recognized preset always implies ACP support, but `acp` can also be asserted by the user for an unrecognized/custom command. */
export function commandSupportsIntegratedMode(command: string): boolean {
  return findAcpPreset(command) !== undefined;
}

/**
 * Resolves the argv to spawn for a *recognized* command's ACP mode, or
 * `null` if it isn't recognized. For CLIs with native ACP support this
 * augments the user's configured command/args with the right flag or
 * subcommand; for agents whose ACP support ships as a separate adapter
 * package, this ignores the configured command entirely and returns that
 * adapter's own binary name (still subject to PATH resolution by the caller).
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

/**
 * Resolves the argv to spawn for a roster agent's ACP mode, or `null` if it
 * doesn't support ACP at all. A recognized preset (matched by command
 * basename) always takes its known invocation quirk from `getAcpLaunchSpec`,
 * even if the roster entry's own `acp` flag happens to be false (a stale
 * import, say) — recognized presets are always ACP-capable. Otherwise, an
 * ad-hoc/custom agent is spawned exactly as configured (no flag/subcommand
 * augmentation) if — and only if — the user has explicitly flagged it with
 * `acp: true`.
 */
export function getAcpLaunchSpecForAgent(agent: Pick<AgentRosterEntry, 'name' | 'command' | 'args' | 'acp'>): AcpPresetInfo | null {
  const preset = getAcpLaunchSpec(agent.command, agent.args);
  if (preset) return preset;
  if (!agent.acp) return null;
  const configuredBin = agent.command.trim().replace(/^["']|["']$/g, '');
  if (!configuredBin) return null;
  return { bin: configuredBin, args: agent.args, label: agent.name || configuredBin };
}

async function buildAgentEnv(args: { workspacePath: string; worktreePath: string; agentId: string }): Promise<Record<string, string>> {
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
    SPROUTGIT_AGENT: args.agentId,
    SPROUTGIT_ISSUE_REF: issueRef,
    SPROUTGIT_ISSUE_URL: issueRef ? resolveIssueUrl(issueRef, issuePatterns) : '',
    SPROUTGIT_ISSUE_TITLE: wtMeta?.issueTitle ?? '',
  };
}

/** Flattens the agent capabilities negotiated by a real ACP `initialize` handshake into a short list of human-readable flags, for display in the Test result. */
function describeAcpCapabilities(caps: AgentCapabilities | undefined): string[] {
  if (!caps) return [];
  const flags: string[] = [];
  if (caps.loadSession) flags.push('loadSession');
  if (caps.promptCapabilities?.image) flags.push('prompt.image');
  if (caps.promptCapabilities?.audio) flags.push('prompt.audio');
  if (caps.promptCapabilities?.embeddedContext) flags.push('prompt.embeddedContext');
  if (caps.mcpCapabilities?.http) flags.push('mcp.http');
  if (caps.mcpCapabilities?.sse) flags.push('mcp.sse');
  return flags;
}

/**
 * Runs a real ACP `initialize` handshake against `bin`/`args` and reports the
 * agent's self-reported name/version/capabilities — used by AGENT_TEST for
 * any agent flagged `acp: true` (recognized preset or ad-hoc), so a custom
 * ACP integration can be verified before it's used in the Chat tab. Spawns
 * the process, completes just the `initialize` call (no `session/new` —
 * this is a capability probe, not a real session), then kills it. Races the
 * handshake against the child exiting early so a bad binary or missing auth
 * surfaces as a clear error instead of a hang.
 */
async function runAcpHandshakeTest(spec: AcpPresetInfo, resolvedBin: string, env: Record<string, string>): Promise<ToolTestResult> {
  const resolvedCommand = `${resolvedBin} ${spec.args.join(' ')}`.trim();
  const child = spawn(resolvedBin, spec.args, {
    cwd: homedir(),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  child.stderr.on('data', d => { stderrBuf += String(d); });

  try {
    const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
    // initialize() never sends session/update or requestPermission -- these
    // handlers exist only to satisfy the Client interface.
    const noopClient: Client = {
      sessionUpdate: () => undefined,
      requestPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
    };
    const connection = new ClientSideConnection(() => noopClient, stream);

    const earlyExit = new Promise<never>((_, reject) => {
      child.once('error', err => reject(err));
      child.once('exit', code => reject(new Error(stderrBuf.trim() || `Agent exited during startup with code ${code}`)));
    });
    earlyExit.catch(() => undefined);

    const response = await Promise.race([
      connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
      earlyExit,
    ]);

    const agentInfo = response.agentInfo;
    const detail = [
      `Agent: ${agentInfo?.name ?? spec.label}${agentInfo?.version ? ` v${agentInfo.version}` : ''}`,
      `Protocol version: ${response.protocolVersion}`,
    ].join(' — ');

    return {
      ok: true,
      resolvedCommand,
      detail,
      acp: {
        name: agentInfo?.name ?? spec.label,
        ...(agentInfo?.version ? { version: agentInfo.version } : {}),
        capabilities: describeAcpCapabilities(response.agentCapabilities),
      },
    };
  } catch (err) {
    return errResult(resolvedCommand, err instanceof Error ? err.message : String(err));
  } finally {
    try { child.kill(); } catch { /* already exited */ }
  }
}

export function registerAgentHandlers(configDb: ConfigDb, userDataPath: string): void {
  handle(IPC.AGENT_ROSTER_GET, (): AgentRoster => getAgentRoster(configDb));

  handle(IPC.AGENT_ROSTER_SAVE, (_e, roster: AgentRoster) => {
    saveAgentRoster(configDb, roster);
  });

  // ── ACP adapter install (Claude Code / Codex CLI) ───────────────────────
  handle(IPC.AGENT_ACP_ADAPTER_STATUS, async (_e, agentId: string): Promise<AcpAdapterStatus | null> => {
    const roster = getAgentRoster(configDb);
    const agent = resolveRosterAgent(roster, agentId);
    const spec = getAcpLaunchSpecForAgent(agent);
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
    agentId?: string;
  }) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (!win) throw new Error('No active window to launch the agent in.');

    const roster = getAgentRoster(configDb);
    const agent = resolveRosterAgent(roster, args.agentId);
    if (!agent.command.trim()) {
      throw new Error('No agent command configured. Set one in Settings → AI Agents.');
    }

    const baseEnv = await buildAgentEnv({ workspacePath: args.workspacePath, worktreePath: args.worktreePath, agentId: agent.id });
    const env = { ...baseEnv, ...agent.env };

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
        label: agent.name || 'AI Agent',
        agentId: agent.id,
        agentName: agent.name || commandToken(agent.command),
      });
    } catch (spawnErr) {
      const message = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      throw new Error(`Failed to launch agent (command: ${JSON.stringify(agent.command)}, args: ${JSON.stringify(agent.args)}): ${message}`, { cause: spawnErr });
    }

    sessionWindows.set(id, win);

    win.webContents.send(IPC.EVENT_AGENT_TERMINAL_LAUNCH, {
      terminalId: id,
      cwd: args.worktreePath,
    });

    return id;
  });

  // ── Test ──────────────────────────────────────────────────────────────
  // Runs a real scenario against the given (possibly unsaved) agent entry,
  // so the Settings UI can validate an edit before it's saved to the
  // roster. For ACP-flagged agents (a recognized preset, or an ad-hoc entry
  // the user has asserted speaks ACP), this performs a real ACP `initialize`
  // handshake and reports the agent's name/version/capabilities. Otherwise
  // it falls back to the previous behavior: a small fixed real prompt for
  // Claude Code (the only command known to support a non-interactive `-p`
  // flag), or just confirming the binary resolves for anything else.
  handle(IPC.AGENT_TEST, async (_e, input: AgentTestInput): Promise<ToolTestResult> => {
    // input.command is always just the binary (args live separately in
    // input.args) — strip a wrapping quote pair rather than running it
    // through splitCommand()'s general tokenizer, which would incorrectly
    // split an unquoted absolute path containing spaces (common on Windows).
    const bin = input.command.trim().replace(/^["']|["']$/g, '');
    if (!bin) return errResult('', 'No agent command configured.');

    const agentLike = { name: input.name ?? bin, command: input.command, args: input.args, acp: input.acp };
    const acpSpec = getAcpLaunchSpecForAgent(agentLike);
    if (acpSpec) {
      const resolvedBin = acpSpec.npmPackage
        ? await resolveAcpAdapterBin(userDataPath, acpSpec)
        : await resolveCommandPath(acpSpec.bin);
      if (!resolvedBin) {
        const hint = acpSpec.npmPackage
          ? ` Install it from Settings → AI Agents, or run: npm install -g ${acpSpec.npmPackage}`
          : '';
        return errResult(acpSpec.bin, `Could not find "${acpSpec.bin}" (${acpSpec.label}'s ACP mode) on PATH.${hint}`);
      }
      return runAcpHandshakeTest(acpSpec, resolvedBin, input.env ?? {});
    }

    const resolved = await resolveCommandPath(bin);
    if (!resolved) return errResult(bin, `Command not found on PATH: ${bin}`);

    if (!commandIsClaudeCli(input.command)) {
      return okResult(resolved, `Found ${resolved}. This command's non-interactive prompt flag isn't known, so a live prompt test wasn't run — only Claude Code supports that right now.`);
    }

    const prompt = 'Reply with only the word OK.';
    const testArgs = [...input.args, '-p', prompt];
    const resolvedCommand = `${resolved} ${testArgs.join(' ')}`;

    return new Promise(resolve => {
      const child = execFile(
        resolved,
        testArgs,
        { timeout: 15_000, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, ...input.env } },
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
