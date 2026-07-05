/**
 * Shared helpers for the settings-row "Test" buttons (editor, diff tool,
 * merge tool, AI agent, commit message generator, shell). Each test exercises
 * a real scenario — not `<cmd> --version` — and reports back a resolved
 * command plus truncated output so the row can show more than pass/fail.
 */
import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { ToolTestResult } from "@sproutgit/types";

const execFileAsync = promisify(execFile);

const SAFE_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  process.env.PATH ?? "",
].join(":");

/**
 * Known GUI editors that ship a CLI shim inside their macOS .app bundle at a
 * fixed relative path. VS Code, Cursor, and Windsurf only install that shim
 * on PATH if the user has run the app's own "Shell Command: Install 'x'
 * command in PATH" — a very common thing to skip, which otherwise makes an
 * installed app falsely report as "not found".
 */
const MAC_APP_BUNDLE_CLIS: Record<
  string,
  { appName: string; binPath: string }
> = {
  code: {
    appName: "Visual Studio Code",
    binPath: "Contents/Resources/app/bin/code",
  },
  cursor: { appName: "Cursor", binPath: "Contents/Resources/app/bin/cursor" },
  windsurf: {
    appName: "Windsurf",
    binPath: "Contents/Resources/app/bin/windsurf",
  },
};

/** Falls back to a known .app bundle's embedded CLI binary on macOS when `cmd` isn't resolvable via PATH — see MAC_APP_BUNDLE_CLIS. */
export async function resolveMacAppBundleCli(
  cmd: string,
): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const known = MAC_APP_BUNDLE_CLIS[cmd];
  if (!known) return null;
  for (const appsDir of ["/Applications", join(homedir(), "Applications")]) {
    const candidate = join(appsDir, `${known.appName}.app`, known.binPath);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next location
    }
  }
  return null;
}

/** Resolves a bare command name to its full path, or null if not found on PATH (or, on macOS, inside a known .app bundle). */
export async function resolveCommandPath(cmd: string): Promise<string | null> {
  const trimmed = cmd.trim();
  if (!trimmed) return null;
  if (isAbsolute(trimmed)) {
    // Already a fully-qualified path (e.g. a quoted GUI-app path from the
    // editor/diff/merge-tool settings, or process.execPath in tests) —
    // confirm it exists instead of re-resolving it through which/where,
    // which unreliably reports literal absolute paths as not found on
    // Windows even when the file is right there.
    try {
      await access(trimmed);
      return trimmed;
    } catch {
      return null;
    }
  }
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const envOpts =
    process.platform !== "win32"
      ? { env: { ...process.env, PATH: SAFE_PATH } }
      : {};
  try {
    const { stdout } = await execFileAsync(whichCmd, [trimmed], envOpts);
    const resolved = stdout.trim().split("\n")[0]?.trim() || null;
    if (resolved) return resolved;
  } catch {
    // fall through to the bundle-path fallback below
  }
  return resolveMacAppBundleCli(trimmed);
}

/** Truncates text for inline display near a settings row. */
export function truncate(text: string, max = 400): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}… (truncated, ${trimmed.length} chars total)`;
}

/**
 * Tokenizes a command string on whitespace, honoring a quoted segment at the
 * *start* of each token — e.g. `code --wait --diff "$LOCAL" "$REMOTE"`
 * becomes `['code', '--wait', '--diff', '$LOCAL', '$REMOTE']`, quotes
 * stripped, so a naive whitespace split doesn't leave literal `"` characters
 * glued to `$LOCAL`/`$REMOTE` (which then get spawned, without a shell, as
 * bogus quote-mangled file paths).
 *
 * A quote is only special when it opens a token: a quote character appearing
 * mid-token (e.g. inline script text like `require('fs')`) is left alone, so
 * arguments that happen to contain literal quote characters as data aren't
 * mangled.
 */
function tokenizeCommand(raw: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    while (i < n && /\s/.test(raw[i]!)) i++;
    if (i >= n) break;
    const quote = raw[i] === '"' || raw[i] === "'" ? raw[i] : null;
    if (quote) {
      i++;
      let token = "";
      while (i < n && raw[i] !== quote) {
        token += raw[i];
        i++;
      }
      if (i < n) i++; // skip the closing quote
      tokens.push(token);
    } else {
      let token = "";
      while (i < n && !/\s/.test(raw[i]!)) {
        token += raw[i];
        i++;
      }
      tokens.push(token);
    }
  }
  return tokens;
}

/** Splits a stored command string (possibly quoted, possibly with inline flags) into [binary, ...leadingArgs]. */
export function splitCommand(raw: string): { bin: string; args: string[] } {
  const tokens = tokenizeCommand(raw.trim());
  return { bin: tokens[0] ?? "", args: tokens.slice(1) };
}

/**
 * Spawns a command (not through a shell) and resolves once the process
 * either exits/errors within `timeoutMs`, or is confirmed alive/launched
 * successfully past `confirmAliveMs` (for GUI editors/diff/merge tools that
 * don't exit promptly — we only need to prove the launch succeeded, not wait
 * for the user to close the app).
 */
export function spawnAndConfirmLaunch(args: {
  bin: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  confirmAliveMs?: number;
}): Promise<{
  ok: boolean;
  pid?: number;
  stdout: string;
  stderr: string;
  error?: string;
  exitCode?: number | null;
}> {
  const {
    bin,
    args: spawnArgs,
    cwd,
    env,
    timeoutMs = 8000,
    confirmAliveMs = 700,
  } = args;
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, spawnArgs, {
        cwd: cwd ?? process.cwd(),
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        ok: false,
        stdout: "",
        stderr: "",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const finish = (result: {
      ok: boolean;
      stdout: string;
      stderr: string;
      error?: string;
      exitCode?: number | null;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(aliveTimer);
      clearTimeout(hardTimer);
      resolve(child.pid !== undefined ? { ...result, pid: child.pid } : result);
    };

    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });

    child.once("error", (err) => {
      finish({ ok: false, stdout, stderr, error: err.message });
    });

    child.once("exit", (code, signal) => {
      // Exit code 0 (or null with no signal, e.g. still-open GUI app detached) is success.
      const ok = code === 0 || (code === null && !signal);
      finish({
        ok,
        stdout,
        stderr,
        exitCode: code,
        ...(ok
          ? {}
          : {
              error: `Exited with code ${String(code)}${signal ? ` (signal ${signal})` : ""}`,
            }),
      });
    });

    // GUI tools (editors, diff/merge tools) commonly stay open — if the
    // process is still alive after confirmAliveMs, treat that as a
    // successful launch rather than waiting for the user to quit it.
    const aliveTimer = setTimeout(() => {
      if (!settled && child.pid) {
        finish({ ok: true, stdout, stderr });
        // Best-effort: don't leave a spawned editor/diff/merge tool as a test artifact.
        try {
          child.kill();
        } catch {
          /* already exited */
        }
      }
    }, confirmAliveMs);

    const hardTimer = setTimeout(() => {
      if (!settled) {
        try {
          child.kill();
        } catch {
          /* already exited */
        }
        finish({
          ok: false,
          stdout,
          stderr,
          error: `Timed out after ${timeoutMs}ms`,
        });
      }
    }, timeoutMs);
  });
}

export function okResult(
  resolvedCommand: string,
  detail: string,
): ToolTestResult {
  return { ok: true, resolvedCommand, detail };
}

export function errResult(
  resolvedCommand: string,
  error: string,
  detail = "",
): ToolTestResult {
  return { ok: false, resolvedCommand, detail, error };
}
