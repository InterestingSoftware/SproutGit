/**
 * Integrated AI agent mode — the "Chat" tab.
 *
 * Spawns the configured agent (currently: Claude Code only, gated by
 * commandSupportsIntegratedMode) with structured streaming output enabled:
 *
 *   claude -p "<prompt>" --output-format stream-json --verbose
 *
 * `--verbose` is required together with `-p --output-format stream-json` in
 * print mode. Each line of stdout is one JSON message; chat-stream-parser.ts
 * normalizes it into ChatStreamEvent(s), which are pushed to the renderer as
 * EVENT_CHAT_STREAM. A follow-up prompt on the same worktree spawns a new
 * `claude -p --resume <session_id>` process seeded from the prior turn's
 * `session_id`, since `claude -p` is a one-shot process per turn.
 */
import type { BrowserWindow } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { IPC } from '@sproutgit/types';
import type { ConfigDb } from '@sproutgit/database';
import { getAgentConfig } from '@sproutgit/database';
import { handle } from './handle.js';
import { log } from '../telemetry.js';
import { parseStreamJsonLine } from './chat-stream-parser.js';
import { resolveCommandPath, splitCommand } from './tool-test-helpers.js';
import { commandSupportsIntegratedMode } from './agents.js';

type ChatSession = {
  id: string;
  worktreePath: string;
  child: ChildProcessWithoutNullStreams | null;
  claudeSessionId: string | null;
  messageIdSeq: { current: number };
};

const sessions = new Map<string, ChatSession>();
const sessionWindows = new Map<string, BrowserWindow>();

function send(win: BrowserWindow | undefined, sessionId: string, event: ReturnType<typeof parseStreamJsonLine>[number]): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.EVENT_CHAT_STREAM, { sessionId, event });
}

/** Extracts the Claude session_id from any stream-json message line, if present. */
function extractSessionId(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return typeof parsed['session_id'] === 'string' ? parsed['session_id'] : null;
  } catch {
    return null;
  }
}

async function spawnClaudeTurn(configDb: ConfigDb, session: ChatSession, prompt: string, win: BrowserWindow | undefined): Promise<void> {
  const agent = getAgentConfig(configDb);
  const { bin, args: leadingArgs } = splitCommand(agent.command);
  const resolved = (await resolveCommandPath(bin)) ?? bin;

  const turnArgs = [
    ...leadingArgs,
    ...agent.args,
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    ...(session.claudeSessionId ? ['--resume', session.claudeSessionId] : []),
  ];

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(resolved, turnArgs, {
      cwd: session.worktreePath,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    log.error('[chat] failed to spawn agent', err);
    send(win, session.id, { type: 'error', message: err instanceof Error ? err.message : String(err) });
    return;
  }

  session.child = child;
  child.stdin.end();

  const rl = createInterface({ input: child.stdout });
  rl.on('line', line => {
    const sessionId = extractSessionId(line);
    if (sessionId) session.claudeSessionId = sessionId;
    const events = parseStreamJsonLine(line, session.messageIdSeq);
    for (const event of events) send(win, session.id, event);
  });

  let stderrBuf = '';
  child.stderr.on('data', d => { stderrBuf += String(d); });

  child.once('error', err => {
    send(win, session.id, { type: 'error', message: err.message });
  });

  child.once('exit', code => {
    session.child = null;
    if (code !== 0 && code !== null) {
      send(win, session.id, { type: 'error', message: stderrBuf.trim() || `Agent process exited with code ${code}` });
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.EVENT_CHAT_EXIT, { sessionId: session.id, exitCode: code ?? -1 });
    }
  });
}

export function registerChatHandlers(configDb: ConfigDb, getWindow: () => BrowserWindow | null): void {
  handle(IPC.CHAT_START, (_e, args: { worktreePath: string; prompt: string }) => {
    const agent = getAgentConfig(configDb);
    if (!commandSupportsIntegratedMode(agent.command)) {
      throw new Error('The configured agent does not support Integrated (structured chat) mode. Only Claude Code is currently supported — use Terminal mode instead.');
    }
    if (agent.mode !== 'integrated') {
      throw new Error('Integrated mode is not enabled for the configured agent. Switch to Integrated mode in Settings → AI Agent.');
    }

    const win = getWindow();
    const id = randomUUID();
    const session: ChatSession = {
      id,
      worktreePath: args.worktreePath,
      child: null,
      claudeSessionId: null,
      messageIdSeq: { current: 0 },
    };
    sessions.set(id, session);
    if (win) sessionWindows.set(id, win);

    void spawnClaudeTurn(configDb, session, args.prompt, win ?? undefined);
    return id;
  });

  handle(IPC.CHAT_SEND, (_e, args: { sessionId: string; prompt: string }) => {
    const session = sessions.get(args.sessionId);
    if (!session) throw new Error(`No chat session found for id "${args.sessionId}".`);
    if (session.child) throw new Error('The agent is still responding to the previous message.');
    const win = sessionWindows.get(args.sessionId);
    void spawnClaudeTurn(configDb, session, args.prompt, win);
  });

  handle(IPC.CHAT_STOP, (_e, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session?.child) {
      try { session.child.kill(); } catch { /* already exited */ }
    }
    sessions.delete(sessionId);
    sessionWindows.delete(sessionId);
  });
}
