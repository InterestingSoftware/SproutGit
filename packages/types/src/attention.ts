/** Which kind of agent session an attention entry describes. */
export type SessionKind = 'chat' | 'terminal';

/**
 * - `working`: actively producing output / mid-turn.
 * - `awaiting-permission`: an explicit permission prompt is blocking progress
 *   (ACP `session/request_permission`, or an inferred PTY y/n prompt).
 * - `awaiting-input`: the agent has stopped and is waiting for the next
 *   message — for chat sessions this is an explicit ACP turn-end signal; for
 *   PTY sessions it's inferred from an output-idle heuristic (see
 *   `heuristic`), since PTY agents expose no protocol to signal this directly.
 * - `finished` / `failed`: the session's process exited (PTY) or the chat
 *   session ended, without / with an error respectively.
 */
export type SessionAttentionState =
  | 'working'
  | 'awaiting-permission'
  | 'awaiting-input'
  | 'finished'
  | 'failed';

export type SessionAttention = {
  sessionId: string;
  kind: SessionKind;
  worktreePath: string;
  state: SessionAttentionState;
  /**
   * True when `state` was inferred from the PTY output-idle heuristic rather
   * than an explicit protocol signal — the UI must label this "Idle" rather
   * than assert the agent is definitely waiting on the user.
   */
  heuristic: boolean;
  updatedAt: number;
};
