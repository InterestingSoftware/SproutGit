/**
 * Types for the Integrated (structured chat) AI agent mode — the "Chat" tab.
 *
 * The main process talks to the configured agent over the Agent Client
 * Protocol (ACP, see https://agentclientprotocol.com) instead of a
 * vendor-specific stdout format. Whichever ACP-mode command is configured
 * (Claude, Gemini, Codex, ...), its `session/update` notifications and
 * `session/request_permission` requests are normalized into the
 * `ChatStreamEvent`s below for the renderer.
 */

/** One turn in the chat transcript, as rendered in the Chat tab. */
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  /** Plain-text content blocks, concatenated for simple rendering. */
  text: string;
  /** Distinct tool-use / tool-result blocks surfaced from the stream, if any. */
  toolUses: ChatToolUse[];
  /** True while this assistant message is still streaming in. */
  streaming: boolean;
};

/** A single tool invocation (and its result, once available) surfaced mid-stream. */
export type ChatToolUse = {
  id: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
};

/** Hint about the nature of a permission option (ACP `PermissionOptionKind`). */
export type ChatPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

/** One choice offered to the user for a pending tool-call permission request. */
export type ChatPermissionOption = {
  id: string;
  name: string;
  kind: ChatPermissionOptionKind;
};

/** A tool call awaiting user authorization before the agent will execute it. */
export type ChatPermissionRequest = {
  requestId: string;
  toolUse: ChatToolUse;
  options: ChatPermissionOption[];
};

/** Normalized event emitted by the main process as it translates the agent's ACP session updates. */
export type ChatStreamEvent =
  | { type: 'assistant_text_delta'; messageId: string; text: string }
  | { type: 'assistant_message_start'; messageId: string }
  | { type: 'assistant_message_end'; messageId: string }
  | { type: 'tool_use'; messageId: string; toolUse: ChatToolUse }
  | { type: 'tool_result'; messageId: string; toolUseId: string; result: string; isError: boolean }
  | { type: 'permission_request'; requestId: string; toolUse: ChatToolUse; options: ChatPermissionOption[] }
  | { type: 'result'; success: boolean; summary: string }
  | { type: 'error'; message: string };

/** Pushed to the renderer as the Chat session's stream is parsed. */
export type ChatSessionEvent = {
  sessionId: string;
  event: ChatStreamEvent;
};

/** Pushed once the underlying process exits. */
export type ChatSessionExitEvent = {
  sessionId: string;
  exitCode: number;
};
