/**
 * Tracks a per-session "attention" state — working / awaiting-permission /
 * awaiting-input / finished / failed — for both ACP chat sessions and
 * PTY-launched agent terminals (see #140). PTY sessions have no protocol to
 * signal "waiting on you" explicitly, so their awaiting-input/idle transitions
 * are driven by `@sproutgit/terminal`'s own output-idle heuristic (`IdleTracker`,
 * added for the OS-notification feature in #92) rather than a second one here
 * — see `app/src/main/ipc/terminal.ts`. This module is intentionally free of
 * Electron/node-pty imports so the state machine itself is unit-testable in
 * isolation; `app/src/main/ipc/session-attention.ts` wires it up to IPC.
 */
import type { SessionAttention, SessionAttentionState, SessionKind } from '@sproutgit/types';

type ChangeListener = (entry: SessionAttention) => void;
type RemoveListener = (sessionId: string) => void;

/** Single source of truth for every tracked session's current attention state. */
export class AttentionTracker {
  private entries = new Map<string, SessionAttention>();
  private changeListeners = new Set<ChangeListener>();
  private removeListeners = new Set<RemoveListener>();
  private removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    const timer = this.removalTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.removalTimers.delete(sessionId);
    }
    if (!this.entries.delete(sessionId)) return;
    for (const listener of this.removeListeners) listener(sessionId);
  }

  /**
   * Removes the session after `delayMs` instead of immediately — used after
   * `setFinished`/`setFailed` so the UI has a chance to actually render the
   * terminal state before the entry disappears. Without this, a session
   * whose process just exited would vanish from `list()` in the same tick it
   * was marked finished/failed, since the owning terminal/chat session map
   * is cleaned up immediately on exit.
   */
  scheduleRemoval(sessionId: string, delayMs: number): void {
    const existing = this.removalTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.remove(sessionId), delayMs);
    timer.unref?.();
    this.removalTimers.set(sessionId, timer);
  }

  get(sessionId: string): SessionAttention | undefined {
    return this.entries.get(sessionId);
  }

  list(): SessionAttention[] {
    return [...this.entries.values()];
  }
}

/** How long a finished/failed session stays visible in `list()`/events after its process exits, before being pruned. */
export const FINISHED_ENTRY_TTL_MS = 5_000;
