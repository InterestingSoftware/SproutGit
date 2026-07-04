/**
 * Types for the Integrated (structured chat) AI agent mode — the "Chat" tab.
 *
 * Today only Claude Code's CLI is recognized as supporting structured
 * streaming output, via `claude -p "<prompt>" --output-format stream-json
 * --verbose`. Each line of stdout is one JSON object; we parse a small subset
 * of the message shapes into a normalized `ChatStreamEvent` for the renderer.
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

/** Normalized event emitted by the main process as it parses the agent's stream-json stdout. */
export type ChatStreamEvent =
  | { type: 'assistant_text_delta'; messageId: string; text: string }
  | { type: 'assistant_message_start'; messageId: string }
  | { type: 'assistant_message_end'; messageId: string }
  | { type: 'tool_use'; messageId: string; toolUse: ChatToolUse }
  | { type: 'tool_result'; messageId: string; toolUseId: string; result: string; isError: boolean }
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
