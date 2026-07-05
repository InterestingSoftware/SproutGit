/**
 * Translates Agent Client Protocol (ACP) `session/update` notifications and
 * `session/request_permission` requests into the normalized
 * `ChatStreamEvent`s the renderer's Chat tab consumes.
 *
 * ACP doesn't delimit "messages" the way Claude's old stream-json output
 * did — a turn is just a sequence of `session/update` notifications. We
 * synthesize one assistant message bubble per prompt turn: the first
 * content-bearing update of a turn opens it (via `TurnState`, tracked by the
 * caller across the whole turn), and the caller closes it once the turn's
 * `session/prompt` call resolves.
 *
 * `user_message_chunk` (turn replay), `agent_thought_chunk` (extended
 * thinking), and plan/mode/session-info/usage updates carry no
 * renderer-visible content in the old Claude-only shape either, so they're
 * dropped here too — this is parity, not a regression. `config_option_update`
 * is the one exception: it surfaces agent-exposed session settings (model
 * choice being the main example) that the old shape had no equivalent for.
 */
import type {
  ContentBlock,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionConfigSelectOptions,
  SessionUpdate,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import type { ChatConfigOption, ChatConfigOptionValue, ChatPermissionOption, ChatStreamEvent, ChatToolUse } from '@sproutgit/types';

/** Per-turn state threaded through translateSessionUpdate() calls for a single `session/prompt` turn. */
export type TurnState = {
  messageId: string | null;
  messageIdSeq: { current: number };
};

function extractText(block: ContentBlock): string {
  return block.type === 'text' ? block.text : '';
}

function toolCallContentText(content: ToolCallContent[] | null | undefined): string {
  if (!content || content.length === 0) return '';
  return content
    .map(item => {
      if (item.type === 'content') return extractText(item.content);
      if (item.type === 'diff') return `${item.path}\n${item.newText}`;
      if (item.type === 'terminal') return '[terminal output]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function toChatToolUse(toolCall: ToolCall | ToolCallUpdate): ChatToolUse {
  const toolUse: ChatToolUse = {
    id: toolCall.toolCallId,
    name: toolCall.title || toolCall.toolCallId,
    input: toolCall.rawInput,
  };
  if (toolCall.content !== undefined) toolUse.result = toolCallContentText(toolCall.content);
  if (toolCall.status === 'failed') toolUse.isError = true;
  return toolUse;
}

/** Ensures the turn's assistant bubble has been opened, returning any `assistant_message_start` event needed plus its id. */
function ensureMessageStarted(turn: TurnState): { events: ChatStreamEvent[]; messageId: string } {
  if (turn.messageId) return { events: [], messageId: turn.messageId };
  const messageId = `assistant-${turn.messageIdSeq.current++}`;
  turn.messageId = messageId;
  return { events: [{ type: 'assistant_message_start', messageId }], messageId };
}

/** Translates one `session/update` payload into zero or more renderer-facing events, mutating `turn` as the bubble opens. */
export function translateSessionUpdate(update: SessionUpdate, turn: TurnState): ChatStreamEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = extractText(update.content);
      if (!text) return [];
      const { events, messageId } = ensureMessageStarted(turn);
      events.push({ type: 'assistant_text_delta', messageId, text });
      return events;
    }
    case 'tool_call': {
      const { events, messageId } = ensureMessageStarted(turn);
      events.push({ type: 'tool_use', messageId, toolUse: toChatToolUse(update) });
      return events;
    }
    case 'tool_call_update': {
      const hasTerminalStatus = update.status === 'completed' || update.status === 'failed';
      if (update.content === undefined && !hasTerminalStatus) return [];
      const { events, messageId } = ensureMessageStarted(turn);
      events.push({
        type: 'tool_result',
        messageId,
        toolUseId: update.toolCallId,
        result: toolCallContentText(update.content),
        isError: update.status === 'failed',
      });
      return events;
    }
    case 'config_option_update':
      return [{ type: 'config_options', options: toChatConfigOptions(update.configOptions) }];
    default:
      return [];
  }
}

/** Translates an agent's `session/request_permission` request into the renderer-facing permission-request event. */
export function translatePermissionRequest(requestId: string, params: RequestPermissionRequest): ChatStreamEvent {
  const options: ChatPermissionOption[] = params.options.map(o => ({ id: o.optionId, name: o.name, kind: o.kind }));
  return { type: 'permission_request', requestId, toolUse: toChatToolUse(params.toolCall), options };
}

/** Flattens ACP's optionally-grouped select values into a single list — SproutGit doesn't render option groups separately (yet). */
function flattenSelectOptions(options: SessionConfigSelectOptions): ChatConfigOptionValue[] {
  if (options.length === 0) return [];
  if ('group' in options[0]!) {
    return (options as Extract<SessionConfigSelectOptions, { group: string }[]>).flatMap(g =>
      g.options.map(o => ({ id: o.value, name: o.name, ...(o.description ? { description: o.description } : {}), group: g.name })),
    );
  }
  return (options as Extract<SessionConfigSelectOptions, { value: string }[]>).map(o => ({
    id: o.value,
    name: o.name,
    ...(o.description ? { description: o.description } : {}),
  }));
}

function toChatConfigOption(option: SessionConfigOption): ChatConfigOption {
  const base = {
    id: option.id,
    name: option.name,
    ...(option.description ? { description: option.description } : {}),
    ...(option.category ? { category: option.category } : {}),
  };
  if (option.type === 'boolean') {
    return { ...base, kind: 'boolean', currentValue: option.currentValue };
  }
  return { ...base, kind: 'select', currentValue: option.currentValue, values: flattenSelectOptions(option.options) };
}

/** Translates the full config-option set ACP returns from `session/new`, `session/set_config_option`, and `config_option_update`. */
export function toChatConfigOptions(options: SessionConfigOption[] | null | undefined): ChatConfigOption[] {
  return (options ?? []).map(toChatConfigOption);
}
