/**
 * Integrated AI agent mode — the "Chat" tab.
 *
 * Spawns the configured agent's Agent Client Protocol (ACP, see
 * https://agentclientprotocol.com) mode invocation — resolved per-preset by
 * `getAcpLaunchSpec()` in agents.ts, since the exact command differs per
 * agent (a CLI flag/subcommand for some, a wholly separate adapter binary
 * for others) — and wraps the connection in `ClientSideConnection` from
 * `@agentclientprotocol/sdk`. Unlike the old Claude-only stream-json
 * integration, the agent process is spawned once per chat session and kept
 * alive for the session's lifetime: `session/prompt` is called once per
 * turn on the same connection, rather than respawning a process per turn.
 *
 * The agent's `session/update` notifications and `session/request_permission`
 * requests are translated by chat-acp-events.ts into the normalized
 * `ChatStreamEvent`s pushed to the renderer as EVENT_CHAT_STREAM.
 */
import { BrowserWindow } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type RequestPermissionOutcome,
  type RequestPermissionResponse,
  type StopReason,
} from '@agentclientprotocol/sdk';
import { IPC } from '@sproutgit/types';
import type { AgentRosterEntry, ChatConfigOption, ChatStreamEvent } from '@sproutgit/types';
import type { ConfigDb } from '@sproutgit/database';
import { getAgentRoster, resolveRosterAgent } from '@sproutgit/database';
import { handle } from './handle.js';
import { log } from '../telemetry.js';
import { attentionTracker } from './session-attention.js';
import { FINISHED_ENTRY_TTL_MS } from '../attention-tracker.js';
import { translateSessionUpdate, translatePermissionRequest, toChatConfigOptions, type TurnState } from './chat-acp-events.js';
import { resolveCommandPath } from './tool-test-helpers.js';
import { getAcpLaunchSpecForAgent } from './agents.js';
import { resolveAcpAdapterBin } from './acp-adapters.js';

type ChatSession = {
  id: string;
  worktreePath: string;
  child: ChildProcessWithoutNullStreams;
  connection: ClientSideConnection;
  acpSessionId: string;
  turn: TurnState;
  pendingPermissions: Map<string, (outcome: RequestPermissionOutcome) => void>;
  /** True while a `session/prompt` call is in flight for this session. */
  busy: boolean;
  /** Latest known set of agent-exposed session settings (model choice, etc.) — see ACP's `session/set_config_option`. */
  configOptions: ChatConfigOption[];
};

const sessions = new Map<string, ChatSession>();
const sessionWindows = new Map<string, BrowserWindow>();

function send(win: BrowserWindow | undefined, sessionId: string, event: ChatStreamEvent): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.EVENT_CHAT_STREAM, { sessionId, event });
}

function resultEventFromStopReason(stopReason: StopReason): ChatStreamEvent {
  switch (stopReason) {
    case 'end_turn':
      return { type: 'result', success: true, summary: '' };
    case 'cancelled':
      return { type: 'result', success: false, summary: 'Cancelled.' };
    case 'max_tokens':
      return { type: 'result', success: false, summary: 'The agent stopped after reaching its maximum output length.' };
    case 'max_turn_requests':
      return { type: 'result', success: false, summary: 'The agent stopped after reaching the maximum number of turn requests.' };
    case 'refusal':
      return { type: 'result', success: false, summary: 'The agent declined to continue with this request.' };
    default:
      return { type: 'result', success: true, summary: '' };
  }
}

/** Builds the ACP `Client` implementation for a session, forwarding session updates and permission requests to the renderer. */
function createClientHandlers(getSession: () => ChatSession): Client {
  return {
    sessionUpdate: notification => {
      const session = getSession();
      const events = translateSessionUpdate(notification.update, session.turn);
      for (const event of events) {
        if (event.type === 'config_options') session.configOptions = event.options;
      }
      const win = sessionWindows.get(session.id);
      for (const event of events) send(win, session.id, event);
    },
    requestPermission: params => new Promise<RequestPermissionResponse>(resolve => {
      const session = getSession();
      const requestId = randomUUID();
      session.pendingPermissions.set(requestId, outcome => resolve({ outcome }));
      attentionTracker.setAwaitingPermission(session.id, 'chat', session.worktreePath);
      send(sessionWindows.get(session.id), session.id, translatePermissionRequest(requestId, params));
    }),
  };
}

/**
 * Spawns the configured agent in ACP mode and completes the `initialize` /
 * `session/new` handshake. Races the handshake against the child process
 * exiting early (bad binary, missing auth, etc.) so a startup failure
 * surfaces as a clear rejection instead of a hang.
 */
async function spawnAcpSession(agent: AgentRosterEntry, worktreePath: string, userDataPath: string): Promise<ChatSession> {
  const spec = getAcpLaunchSpecForAgent(agent);
  if (!spec) throw new Error('The configured agent does not support Agent Client Protocol (ACP) mode.');

  const resolvedBin = spec.npmPackage
    ? await resolveAcpAdapterBin(userDataPath, spec)
    : await resolveCommandPath(spec.bin);
  if (!resolvedBin) {
    const hint = spec.npmPackage
      ? ` Install it from Settings → AI Agents, or run: npm install -g ${spec.npmPackage}`
      : '';
    throw new Error(`Could not find "${spec.bin}" (${spec.label}'s ACP mode) on PATH.${hint}`);
  }

  // spawn() itself can throw synchronously for a bad binary on some
  // platforms; this propagates straight out of spawnAcpSession, which is
  // always awaited inside a handle()-wrapped IPC handler that already logs
  // and rethrows any error, so no separate try/catch is needed here.
  const child = spawn(resolvedBin, spec.args, {
    cwd: worktreePath,
    env: { ...process.env, ...agent.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  child.stderr.on('data', d => { stderrBuf += String(d); });

  const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const connection = new ClientSideConnection(() => createClientHandlers(() => session), stream);

  const session: ChatSession = {
    id: randomUUID(),
    worktreePath,
    child,
    connection,
    acpSessionId: '',
    turn: { messageId: null, messageIdSeq: { current: 0 } },
    pendingPermissions: new Map(),
    busy: false,
    configOptions: [],
  };

  child.on('exit', code => {
    const win = sessionWindows.get(session.id);
    if (win && !win.isDestroyed()) win.webContents.send(IPC.EVENT_CHAT_EXIT, { sessionId: session.id, exitCode: code ?? -1 });
    if (code === 0 || code === null) attentionTracker.setFinished(session.id, 'chat', session.worktreePath);
    else attentionTracker.setFailed(session.id, 'chat', session.worktreePath);
    attentionTracker.scheduleRemoval(session.id, FINISHED_ENTRY_TTL_MS);
    sessions.delete(session.id);
    sessionWindows.delete(session.id);
  });

  // Races the ACP handshake against an early process death so a bad binary
  // or missing auth surfaces as a clear rejection instead of a hang.
  const earlyExit = new Promise<never>((_, reject) => {
    child.once('error', err => reject(err));
    child.once('exit', code => reject(new Error(stderrBuf.trim() || `Agent exited during startup with code ${code}`)));
  });
  earlyExit.catch(() => undefined);

  await Promise.race([
    (async () => {
      await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
      const newSessionResponse = await connection.newSession({ cwd: worktreePath, mcpServers: [] });
      session.acpSessionId = newSessionResponse.sessionId;
      session.configOptions = toChatConfigOptions(newSessionResponse.configOptions);
    })(),
    earlyExit,
  ]);

  return session;
}

async function runTurn(session: ChatSession, prompt: string): Promise<void> {
  session.turn = { messageId: null, messageIdSeq: session.turn.messageIdSeq };
  session.busy = true;
  attentionTracker.setWorking(session.id, 'chat', session.worktreePath);
  const win = () => sessionWindows.get(session.id);
  try {
    const response = await session.connection.prompt({
      sessionId: session.acpSessionId,
      prompt: [{ type: 'text', text: prompt }],
    });
    if (session.turn.messageId) send(win(), session.id, { type: 'assistant_message_end', messageId: session.turn.messageId });
    send(win(), session.id, resultEventFromStopReason(response.stopReason));
  } catch (err) {
    log.error('[chat] turn failed', err);
    if (session.turn.messageId) send(win(), session.id, { type: 'assistant_message_end', messageId: session.turn.messageId });
    send(win(), session.id, { type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    session.busy = false;
    // The child process may have already exited mid-turn (attentionTracker
    // entry removed by the 'exit' handler) — don't resurrect a stale
    // awaiting-input entry for a session that's already gone.
    if (sessions.has(session.id)) attentionTracker.setAwaitingInput(session.id, 'chat', session.worktreePath);
  }
}

export function registerChatHandlers(configDb: ConfigDb, userDataPath: string): void {
  handle(IPC.CHAT_START, async (_e, args: { worktreePath: string; initialPrompt?: string; agentId?: string }) => {
    const roster = getAgentRoster(configDb);
    const agent = resolveRosterAgent(roster, args.agentId);
    if (!getAcpLaunchSpecForAgent(agent)) {
      throw new Error('The configured agent does not support Integrated (ACP) mode — use Terminal mode instead.');
    }
    if (agent.mode !== 'integrated') {
      throw new Error('Integrated mode is not enabled for the configured agent. Switch to Integrated mode in Settings → AI Agents.');
    }

    const session = await spawnAcpSession(agent, args.worktreePath, userDataPath);
    sessions.set(session.id, session);
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (win) sessionWindows.set(session.id, win);
    attentionTracker.setAwaitingInput(session.id, 'chat', session.worktreePath);

    if (args.initialPrompt) void runTurn(session, args.initialPrompt);
    return { sessionId: session.id, configOptions: session.configOptions };
  });

  handle(IPC.CHAT_SEND, (_e, args: { sessionId: string; prompt: string }) => {
    const session = sessions.get(args.sessionId);
    if (!session) throw new Error(`No chat session found for id "${args.sessionId}".`);
    if (session.busy) throw new Error('The agent is still responding to the previous message.');
    void runTurn(session, args.prompt);
  });

  handle(IPC.CHAT_SET_CONFIG_OPTION, async (_e, args: { sessionId: string; configId: string; value: string | boolean }) => {
    const session = sessions.get(args.sessionId);
    if (!session) throw new Error(`No chat session found for id "${args.sessionId}".`);
    const request = typeof args.value === 'boolean'
      ? { sessionId: session.acpSessionId, configId: args.configId, value: args.value, type: 'boolean' as const }
      : { sessionId: session.acpSessionId, configId: args.configId, value: args.value };
    const response = await session.connection.setSessionConfigOption(request);
    session.configOptions = toChatConfigOptions(response.configOptions);
    return session.configOptions;
  });

  handle(IPC.CHAT_RESPOND_PERMISSION, (_e, args: { sessionId: string; requestId: string; optionId: string }) => {
    const session = sessions.get(args.sessionId);
    if (!session) throw new Error(`No chat session found for id "${args.sessionId}".`);
    const resolve = session.pendingPermissions.get(args.requestId);
    if (!resolve) throw new Error(`No pending permission request "${args.requestId}" for this session.`);
    session.pendingPermissions.delete(args.requestId);
    attentionTracker.setWorking(session.id, 'chat', session.worktreePath);
    resolve({ outcome: 'selected', optionId: args.optionId });
  });

  handle(IPC.CHAT_STOP, (_e, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session) {
      for (const resolve of session.pendingPermissions.values()) resolve({ outcome: 'cancelled' });
      session.pendingPermissions.clear();
      if (session.acpSessionId) void session.connection.cancel({ sessionId: session.acpSessionId }).catch(() => undefined);
      try { session.child.kill(); } catch { /* already exited */ }
    }
    attentionTracker.remove(sessionId);
    sessions.delete(sessionId);
    sessionWindows.delete(sessionId);
  });
}
