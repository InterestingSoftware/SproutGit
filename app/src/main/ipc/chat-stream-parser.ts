/**
 * Parses one line of `claude -p --output-format stream-json --verbose` stdout
 * into normalized ChatStreamEvent(s).
 *
 * We deliberately do NOT pass --include-partial-messages: without it, each
 * line is a single complete message object (type: "system" | "assistant" |
 * "user" | "result"), which is far simpler and more robust to parse than the
 * raw Anthropic API stream-event shape (content_block_delta, etc.) — at the
 * cost of streaming per-message rather than per-token. Each assistant/user
 * message's `content` is an array of blocks: `{ type: 'text', text }`,
 * `{ type: 'tool_use', id, name, input }`, or (on the `user` echo message)
 * `{ type: 'tool_result', tool_use_id, content, is_error }`.
 */
import type { ChatStreamEvent, ChatToolUse } from '@sproutgit/types';

/**
 * Loosely typed — a content block's fields depend on its `type`, but we only
 * ever read fields after checking `type` at runtime, so a plain shape with
 * every possible field marked optional avoids fighting a discriminated union
 * across an `unknown`-derived array.
 */
type AnthropicContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

function blockResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(c => (c && typeof c === 'object' && 'text' in c && typeof (c as { text: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Parses a single NDJSON line into zero or more normalized events. A parse
 * failure (malformed JSON, unrecognized shape) yields no events rather than
 * throwing — a stray non-JSON line on stdout must not crash the session.
 */
export function parseStreamJsonLine(line: string, messageIdSeq: { current: number }): ChatStreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as Record<string, unknown>;
  const type = obj['type'];

  if (type === 'assistant') {
    const message = obj['message'] as { content?: AnthropicContentBlock[] } | undefined;
    const blocks = Array.isArray(message?.content) ? message!.content : [];
    const messageId = `assistant-${messageIdSeq.current++}`;
    const events: ChatStreamEvent[] = [{ type: 'assistant_message_start', messageId }];
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        events.push({ type: 'assistant_text_delta', messageId, text: block.text });
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        const toolUse: ChatToolUse = { id: block.id, name: block.name, input: block.input };
        events.push({ type: 'tool_use', messageId, toolUse });
      }
    }
    events.push({ type: 'assistant_message_end', messageId });
    return events;
  }

  if (type === 'user') {
    // Echo of tool_result blocks fed back to the model — surface them
    // attached to the most recent assistant message via a synthetic id;
    // the renderer matches on toolUseId instead of messageId for these.
    const message = obj['message'] as { content?: AnthropicContentBlock[] } | undefined;
    const blocks = Array.isArray(message?.content) ? message!.content : [];
    const events: ChatStreamEvent[] = [];
    for (const block of blocks) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        events.push({
          type: 'tool_result',
          messageId: '',
          toolUseId: block.tool_use_id,
          result: blockResultText(block.content),
          isError: block.is_error === true,
        });
      }
    }
    return events;
  }

  if (type === 'result') {
    const isError = obj['is_error'] === true;
    const resultText = typeof obj['result'] === 'string' ? obj['result'] : '';
    return [{ type: 'result', success: !isError, summary: resultText }];
  }

  // 'system' (session init) and any other/unknown message types carry no
  // renderer-visible content — safe to ignore.
  return [];
}
