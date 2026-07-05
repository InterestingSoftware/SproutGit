import { ipcMain, app, shell, dialog, BrowserWindow } from "electron";
import { IPC } from "@sproutgit/types";
import type { EditorInfo, GitToolInfo } from "@sproutgit/types";
import { getGitConfig, setGitConfig } from "@sproutgit/git/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { resolveMacAppBundleCli, splitCommand } from "./tool-test-helpers.js";

const exec = promisify(execFile);

// PATH that includes common install locations so Electron's restricted env finds tools.
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

// ── Shell detection ───────────────────────────────────────────────────────────

/** Resolve the full path of a command, or return null if not found (or, on macOS, inside a known .app bundle — see resolveMacAppBundleCli). */
async function resolveCommand(cmd: string): Promise<string | null> {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const envOpts =
    process.platform !== "win32"
      ? { env: { ...process.env, PATH: SAFE_PATH } }
      : {};
  try {
    const { stdout } = await exec(whichCmd, [cmd], envOpts);
    const resolved = stdout.trim().split("\n")[0]?.trim() || null;
    if (resolved) return resolved;
  } catch {
    // fall through to the bundle-path fallback below
  }
  return resolveMacAppBundleCli(cmd);
}

const SHELL_INFO: Array<{ name: string; cmd: string }> = [
  { name: "Zsh", cmd: "zsh" },
  { name: "Bash", cmd: "bash" },
  { name: "Fish", cmd: "fish" },
];

async function detectShells(): Promise<{ name: string; path: string }[]> {
  const results: { name: string; path: string }[] = [];
  for (const s of SHELL_INFO) {
    const p = await resolveCommand(s.cmd);
    if (p) results.push({ name: s.name, path: p });
  }
  if (process.platform === "win32") {
    const pwsh = await resolveCommand("pwsh");
    if (pwsh) results.push({ name: "PowerShell", path: pwsh });
    const ps = await resolveCommand("powershell");
    if (ps) results.push({ name: "Windows PowerShell", path: ps });
  }
  return results;
}

// ── Editor detection ──────────────────────────────────────────────────────────

const KNOWN_EDITORS: Array<{
  id: string;
  name: string;
  command: string;
  macArgs?: string[];
}> = [
  { id: "code", name: "VS Code", command: "code" },
  { id: "cursor", name: "Cursor", command: "cursor" },
  { id: "windsurf", name: "Windsurf", command: "windsurf" },
  { id: "zed", name: "Zed", command: "zed" },
  { id: "nvim", name: "Neovim", command: "nvim" },
  { id: "vim", name: "Vim", command: "vim" },
  { id: "subl", name: "Sublime Text", command: "subl" },
  { id: "atom", name: "Atom", command: "atom" },
  { id: "emacs", name: "Emacs", command: "emacs" },
];

async function detectEditors(): Promise<EditorInfo[]> {
  const results: EditorInfo[] = [];
  for (const e of KNOWN_EDITORS) {
    const resolved = await resolveCommand(e.command);
    results.push({
      id: e.id,
      name: e.name,
      command: e.command,
      resolvedCommand: resolved ?? e.command,
      installed: resolved !== null,
    });
  }
  return results;
}

// ── Git tool detection ────────────────────────────────────────────────────────

const KNOWN_GIT_TOOLS: Array<{
  id: string;
  name: string;
  command: string;
  supportsDiff: boolean;
  supportsMerge: boolean;
}> = [
  {
    id: "vscode",
    name: "VS Code",
    command: "code",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "windsurf",
    name: "Windsurf",
    command: "windsurf",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "kiro",
    name: "Kiro",
    command: "kiro",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "sublime",
    name: "Sublime Text",
    command: "subl",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "zed",
    name: "Zed",
    command: "zed",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "vimdiff",
    name: "Vimdiff",
    command: "vim",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "meld",
    name: "Meld",
    command: "meld",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "kdiff3",
    name: "KDiff3",
    command: "kdiff3",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "opendiff",
    name: "FileMerge",
    command: "opendiff",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "p4merge",
    name: "P4Merge",
    command: "p4merge",
    supportsDiff: true,
    supportsMerge: true,
  },
  {
    id: "difftastic",
    name: "Difftastic",
    command: "difft",
    supportsDiff: true,
    supportsMerge: false,
  },
  {
    id: "delta",
    name: "Delta",
    command: "delta",
    supportsDiff: true,
    supportsMerge: false,
  },
];

async function detectGitTools(): Promise<GitToolInfo[]> {
  const results: GitToolInfo[] = [];
  for (const t of KNOWN_GIT_TOOLS) {
    const resolved = await resolveCommand(t.command);
    results.push({
      ...t,
      resolvedCommand: resolved ?? t.command,
      installed: resolved !== null,
    });
  }
  return results;
}

// ── IPC registration ──────────────────────────────────────────────────────────

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC.SYSTEM_APP_VERSION, () => app.getVersion());

  ipcMain.handle(IPC.SYSTEM_GET_HOME_DIR, () => homedir());

  ipcMain.handle(IPC.SYSTEM_LIST_SHELLS, () => detectShells());

  ipcMain.handle(IPC.SYSTEM_DETECT_EDITORS, () => detectEditors());

  ipcMain.handle(IPC.SYSTEM_DETECT_GIT_TOOLS, () => detectGitTools());

  ipcMain.handle(IPC.GIT_GET_CONFIG, (_e, key: string) => getGitConfig(key));

  ipcMain.handle(
    IPC.GIT_SET_CONFIG,
    (_e, args: { key: string; value: string | null }) =>
      setGitConfig(args.key, args.value),
  );

  ipcMain.handle(
    IPC.SYSTEM_OPEN_IN_EDITOR,
    async (_e, worktreePath: string) => {
      // Use the configured editor from git config; fall back to VS Code.
      // core.editor may be a quoted path with flags (e.g. `"/Applications/Visual
      // Studio Code.app/.../code" --wait`) — splitCommand() (not a naive
      // whitespace split) is needed so a quoted absolute path containing
      // spaces isn't torn apart.
      const configuredEditor = await getGitConfig("core.editor").catch(
        () => "",
      );
      const { bin, args } = splitCommand(configuredEditor.trim() || "code");
      await exec(bin || "code", [...args, worktreePath]).catch(() => {
        void shell.openPath(worktreePath);
      });
    },
  );

  ipcMain.handle(IPC.SYSTEM_REVEAL_IN_FINDER, (_e, filePath: string) =>
    shell.showItemInFolder(filePath),
  );

  ipcMain.handle(IPC.SYSTEM_OPEN_URL, (_e, url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Blocked non-http URL scheme: ${parsed.protocol}`);
    }
    return shell.openExternal(url);
  });

  // ── Native dialogs ────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.DIALOG_SHOW_OPEN,
    async (
      event,
      opts: {
        title?: string;
        defaultPath?: string;
        properties?: Array<
          "openFile" | "openDirectory" | "multiSelections" | "showHiddenFiles"
        >;
      },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const dialogOptions: Electron.OpenDialogOptions = {
        title: opts.title ?? "Open",
        properties: opts.properties ?? ["openDirectory"],
      };
      if (opts.defaultPath) dialogOptions.defaultPath = opts.defaultPath;
      const result = await dialog.showOpenDialog(
        win ?? BrowserWindow.getAllWindows()[0]!,
        dialogOptions,
      );
      return result.canceled ? [] : result.filePaths;
    },
  );

  // ── Window controls ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle(IPC.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle(IPC.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
}
