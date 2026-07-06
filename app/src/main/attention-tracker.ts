/**
 * Tracks a per-session "attention" state — working / awaiting-permission /
 * awaiting-input / finished / failed — for both ACP chat sessions and
 * PTY-launched agent terminals (see #140). This module is intentionally free
 * of Electron/node-pty imports so the state machine itself is unit-testable
 * in isolation; `app/src/main/ipc/session-attention.ts` wires it up to IPC.
 */
import type { SessionAttention, SessionAttentionState, SessionKind } from '@sproutgit/types';

type ChangeListener = (entry: SessionAttention) => void;
type RemoveListener = (sessionId: string) => void;

/** Single source of truth for every tracked session's current attention state. */
export class AttentionTracker {
  private entries = new Map<string, SessionAttention>();
  private changeListeners = new Set<ChangeListener>();
  private removeListeners = new Set<RemoveListener>();

  onChange(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onRemove(listener: RemoveListener): () => void {
    this.removeListeners.add(listener);
    return () => this.removeListeners.delete(listener);
  }

  private set(sessionId: string, kind: SessionKind, worktreePath: string, state: SessionAttentionState, heuristic: boolean): void {
    const entry: SessionAttention = { sessionId, kind, worktreePath, state, heuristic, updatedAt: Date.now() };
    this.entries.set(sessionId, entry);
    for (const listener of this.changeListeners) listener(entry);
  }

  setWorking(sessionId: string, kind: SessionKind, worktreePath: string): void {
    this.set(sessionId, kind, worktreePath, 'working', false);
  }

  setAwaitingPermission(sessionId: string, kind: SessionKind, worktreePath: string): void {
    this.set(sessionId, kind, worktreePath, 'awaiting-permission', false);
  }

  setAwaitingInput(sessionId: string, kind: SessionKind, worktreePath: string): void {
    this.set(sessionId, kind, worktreePath, 'awaiting-input', false);
  }

  /** Same visible state as `setAwaitingInput`, but flagged `heuristic: true` so the UI can label it "Idle" instead of asserting the agent is definitely waiting on the user. */
  setIdle(sessionId: string, kind: SessionKind, worktreePath: string): void {
    this.set(sessionId, kind, worktreePath, 'awaiting-input', true);
  }

  setFinished(sessionId: string, kind: SessionKind, worktreePath: string): void {
    this.set(sessionId, kind, worktreePath, 'finished', false);
  }

  setFailed(sessionId: string, kind: SessionKind, worktreePath: string): void {
    this.set(sessionId, kind, worktreePath, 'failed', false);
  }

  remove(sessionId: string): void {
    if (!this.entries.delete(sessionId)) return;
    for (const listener of this.removeListeners) listener(sessionId);
  }

  get(sessionId: string): SessionAttention | undefined {
    return this.entries.get(sessionId);
  }

  list(): SessionAttention[] {
    return [...this.entries.values()];
  }
}

/** How long a PTY-mode agent session must produce no output before the idle heuristic marks it "awaiting-input". Conservative on purpose — a false "idle" for a session that's actually thinking is worse than a late one. */
export const PTY_IDLE_THRESHOLD_MS = 20_000;

/** How often `sweep()` should be called by the caller's interval timer. */
export const PTY_IDLE_CHECK_INTERVAL_MS = 5_000;

/**
 * Best-effort output-idle heuristic for PTY agent sessions, which — unlike
 * ACP chat sessions — have no protocol to signal "I'm waiting on you" (a
 * process sitting on a y/n prompt looks identical to one still working).
 * Only sessions explicitly `start()`ed are watched; callers should only do
 * this for agent-launched terminals, not plain shells.
 */
export class PtyIdleHeuristic {
  private sessions = new Map<string, { worktreePath: string; lastOutputAt: number }>();

  constructor(
    private readonly tracker: AttentionTracker,
    private readonly nowFn: () => number = Date.now,
  ) {}

  start(sessionId: string, worktreePath: string): void {
    this.sessions.set(sessionId, { worktreePath, lastOutputAt: this.nowFn() });
    this.tracker.setWorking(sessionId, 'terminal', worktreePath);
  }

  /** Call on every PTY data chunk. No-op for sessions not being watched. */
  noteOutput(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastOutputAt = this.nowFn();
    const current = this.tracker.get(sessionId);
    // Only flip back to "working" if we'd previously inferred idle — an
    // explicit awaiting-permission signal (from prompt-pattern matching, were
    // one added later) shouldn't be silently overwritten by output.
    if (current?.heuristic) this.tracker.setWorking(sessionId, 'terminal', session.worktreePath);
  }

  /** Call when the underlying PTY process exits. No-op for sessions not being watched. */
  finish(sessionId: string, success: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (success) this.tracker.setFinished(sessionId, 'terminal', session.worktreePath);
    else this.tracker.setFailed(sessionId, 'terminal', session.worktreePath);
    this.sessions.delete(sessionId);
    this.tracker.remove(sessionId);
  }

  /** Sweeps every watched session, flagging any silent past `PTY_IDLE_THRESHOLD_MS` as idle. Intended to be called on an interval. */
  sweep(): void {
    const now = this.nowFn();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastOutputAt < PTY_IDLE_THRESHOLD_MS) continue;
      const current = this.tracker.get(sessionId);
      if (current && !current.heuristic && current.state === 'working') {
        this.tracker.setIdle(sessionId, 'terminal', session.worktreePath);
      }
    }
  }
}
