import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { type WorkspaceHookShell } from '@sproutgit/types';
import { isPathWithin } from '@sproutgit/paths';

export type TerminalDataCallback = (sessionId: string, data: string) => void;
export type TerminalExitCallback = (sessionId: string, exitCode: number) => void;

export type SpawnOptions = {
  cwd: string;
  shell: WorkspaceHookShell | string;
  /** Positional args passed directly to the spawned executable (e.g. agent CLI flags). */
  args?: string[];
  /** Optional one-shot command injected after spawn (e.g. a hook script). */
  command?: string | null;
  /** Environment variable overrides merged on top of `process.env`. */
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /**
   * When false, `shell` is spawned exactly as given instead of being passed
   * through resolveShellBin()'s shell-name resolution/fallback logic — which
   * can silently substitute the platform default shell for an empty string
   * or an unresolvable path. Callers spawning an explicit executable (e.g. an
   * agent CLI) should set this to false so a misconfigured command fails
   * loudly instead of quietly launching a plain shell mislabeled as the agent.
   * Defaults to true.
   */
  resolveShell?: boolean;
};

type Session = {
  id: string;
  pty: pty.IPty;
};

/**
 * Manages all active PTY sessions for the lifetime of the Electron main process.
 *
 * Usage:
 *   const manager = new TerminalManager(onData, onExit);
 *   const id = manager.spawn({ cwd, shell: 'zsh' });
 *   manager.write(id, 'ls\r');
 *   manager.resize(id, 120, 40);
 *   manager.close(id);
 */
/**
 * Upper bound on concurrent PTY sessions. Without a cap, a renderer bug (or a
 * runaway loop calling spawn) could exhaust OS process/file-descriptor limits
 * with no backpressure.
 */
const MAX_SESSIONS = 64;

export class TerminalManager {
  private sessions = new Map<string, Session>();
  protected readonly onData: TerminalDataCallback;
  protected readonly onExit: TerminalExitCallback;

  constructor(onData: TerminalDataCallback, onExit: TerminalExitCallback) {
    this.onData = onData;
    this.onExit = onExit;
  }

  /**
   * Spawns a new PTY session and returns its unique session ID.
   */
  spawn(options: SpawnOptions): string {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`Terminal session limit reached (${MAX_SESSIONS}). Close an existing terminal first.`);
    }

    const id = randomUUID();
    const { cwd, shell, args = [], command, env, cols = 80, rows = 24, resolveShell = true } = options;

    const resolvedShell = resolveShell ? resolveShellBin(shell) : shell;
    // Unlike a real shell, node-pty spawns the executable directly via Win32
    // CreateProcess, which — given a bare command name — does not search PATH
    // or resolve PATHEXT the way cmd.exe/PowerShell do. That's invisible for
    // hook scripts (they're typed into an already-running shell session), but
    // an agent CLI spawned as the process itself (resolveShell: false) fails
    // with "File not found" for anything short of a fully-qualified path —
    // including npm-installed global shims like `claude.cmd`. Resolve to the
    // full path via `where` first, same as resolveCommand() in system.ts.
    const shellBin = process.platform === 'win32' ? resolveWindowsExecutable(resolvedShell) : resolvedShell;
    const safeCwd = existsSync(cwd) ? cwd : process.cwd();

    // Strip lifecycle variables injected by the dev-server launcher (e.g.
    // `npm_lifecycle_event`, `npm_package_*`, `INIT_CWD`). These are specific
    // to the outer `pnpm dev` invocation and should not leak into terminal
    // sessions where they could confuse package managers or build tools.
    const baseEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (k.startsWith('npm_') || k === 'INIT_CWD') continue;
      baseEnv[k] = v;
    }

    const proc = pty.spawn(shellBin, args, {
      name: 'xterm-256color',
      cwd: safeCwd,
      env: {
        ...baseEnv,
        ...env,
      },
      cols,
      rows,
      // Force ConPTY on Windows so the PTY session is fully isolated from any
      // console the Electron process inherited (e.g. the pnpm dev terminal).
      // Without this, node-pty may fall back to WinPTY which leaks output to
      // the parent console.
      ...(process.platform === 'win32' && { useConpty: true }),
    });

    proc.onData(data => this.onData(id, data));

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.onExit(id, exitCode);
    });

    // Inject a one-shot command (e.g. from a hook launch event).
    if (command) {
      proc.write(`${command}\r`);
    }

    this.sessions.set(id, { id, pty: proc });
    return id;
  }

  /**
   * Sends raw input to a PTY session (keyboard data from the renderer).
   */
  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.pty.write(data);
  }

  /**
   * Resizes a PTY session to match the terminal UI dimensions.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.pty.resize(cols, rows);
  }

  /**
   * Terminates a PTY session.
   */
  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.kill();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Closes all PTY sessions whose `cwd` starts with `pathPrefix`.
   * Used when a worktree is removed so stale terminals don't linger.
   */
  closeForPath(_pathPrefix: string): void {
    // cwd is not tracked in the base class — override in TerminalManagerWithMeta.
  }

  /** Returns the number of currently active sessions. */
  get size(): number {
    return this.sessions.size;
  }
}

/**
 * Extended terminal manager that also tracks session metadata (cwd, label)
 * so `closeForPath` can work correctly and the renderer can rebuild labels.
 */
export class TerminalManagerWithMeta extends TerminalManager {
  protected meta = new Map<string, { cwd: string; label: string; agentId: string | null }>();

  override spawn(options: SpawnOptions & { label?: string; agentId?: string }): string {
    const id = super.spawn(options);
    this.meta.set(id, { cwd: options.cwd, label: options.label ?? options.cwd, agentId: options.agentId ?? null });
    return id;
  }

  override close(sessionId: string): void {
    super.close(sessionId);
    this.meta.delete(sessionId);
  }

  override closeForPath(pathPrefix: string): void {
    // isPathWithin requires a path-separator boundary (or an exact match) so
    // removing "worktrees/foo" doesn't also close a terminal cwd'd into the
    // sibling directory "worktrees/foobar".
    for (const [id, m] of this.meta) {
      if (isPathWithin(m.cwd, pathPrefix)) {
        this.close(id);
      }
    }
  }

  closeAll(): void {
    for (const id of [...this.meta.keys()]) {
      this.close(id);
    }
  }

  getLabel(sessionId: string): string | undefined {
    return this.meta.get(sessionId)?.label;
  }

  listSessions(): { id: string; cwd: string; label: string; agentId: string | null }[] {
    return Array.from(this.meta.entries()).map(([id, m]) => ({ id, cwd: m.cwd, label: m.label, agentId: m.agentId }));
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function resolveShellBin(shell: string): string {
  const isWindows = process.platform === 'win32';
  const unixDefault = '/bin/zsh';
  const winDefault = 'powershell.exe';
  const platformDefault = isWindows ? winDefault : unixDefault;

  const value = shell.trim();
  if (!value) return platformDefault;

  // Only strip trailing args (e.g. "zsh -l" → "zsh") for short command names.
  // Absolute paths like "C:\Program Files\PowerShell\7\pwsh.exe" must not be
  // split on whitespace — they contain spaces in directory names.
  const isAbsolutePath = /^([A-Za-z]:[\\/]|\/)/.test(value);
  const executable = isAbsolutePath ? value : (value.split(/\s+/)[0] ?? value);

  switch (executable) {
    case 'zsh':
      return isWindows ? winDefault : '/bin/zsh';
    case 'bash':
      return isWindows ? winDefault : '/bin/bash';
    case 'pwsh':
      return 'pwsh';
    case 'powershell':
    case 'powershell.exe':
      return 'powershell.exe';
    case 'cmd':
    case 'cmd.exe':
      return 'cmd.exe';
    default:
      // Full path passed directly (e.g. '/bin/zsh' or 'C:\Program Files\...\pwsh.exe')
      if (executable.startsWith('/')) {
        try {
          accessSync(executable, constants.X_OK);
          return executable;
        } catch {
          return platformDefault;
        }
      }
      // Windows absolute path — return as-is and let node-pty resolve it
      if (/^[A-Za-z]:[\\/]/.test(executable)) {
        return executable;
      }
      return executable;
  }
}

/**
 * Resolves a bare command name (e.g. "node", "claude") to its full path on
 * Windows via the `where` command, so it can be handed directly to node-pty.
 * No-op for already-qualified paths (drive letter or UNC). Falls back to the
 * original value if resolution fails, so spawn() still fails loudly with a
 * recognizable command name instead of a raw lookup error.
 */
function resolveWindowsExecutable(command: string): string {
  if (/^[A-Za-z]:[\\/]/.test(command) || command.startsWith('\\\\')) return command;
  try {
    const output = execFileSync('where', [command], { encoding: 'utf8' });
    const first = output.split(/\r?\n/).find(line => line.trim().length > 0);
    return first?.trim() || command;
  } catch {
    return command;
  }
}
