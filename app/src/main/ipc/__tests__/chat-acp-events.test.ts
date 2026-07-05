import { describe, it, expect } from 'vitest';
import type { RequestPermissionRequest, SessionConfigOption, SessionUpdate } from '@agentclientprotocol/sdk';
import { translatePermissionRequest, translateSessionUpdate, toChatConfigOptions, type TurnState } from '../chat-acp-events.js';

function turn(): TurnState {
  return { messageId: null, messageIdSeq: { current: 0 } };
}

describe('translateSessionUpdate', () => {
  it('opens a message bubble on the first agent_message_chunk and emits its text delta', () => {
    const t = turn();
    const update: SessionUpdate = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello there' } };
    expect(translateSessionUpdate(update, t)).toEqual([
      { type: 'assistant_message_start', messageId: 'assistant-0' },
      { type: 'assistant_text_delta', messageId: 'assistant-0', text: 'Hello there' },
    ]);
    expect(t.messageId).toBe('assistant-0');
  });

  it('does not re-open the bubble for a second chunk in the same turn', () => {
    const t = turn();
    translateSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'one ' } }, t);
    const events = translateSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'two' } }, t);
    expect(events).toEqual([{ type: 'assistant_text_delta', messageId: 'assistant-0', text: 'two' }]);
  });

  it('ignores a non-text content block in an agent_message_chunk', () => {
    const t = turn();
    const update: SessionUpdate = { sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'xx', mimeType: 'image/png' } };
    expect(translateSessionUpdate(update, t)).toEqual([]);
    expect(t.messageId).toBeNull();
  });

  it('ignores user_message_chunk and agent_thought_chunk updates', () => {
    const t = turn();
    expect(translateSessionUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'echo' } }, t)).toEqual([]);
    expect(translateSessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking...' } }, t)).toEqual([]);
    expect(t.messageId).toBeNull();
  });

  it('emits a tool_use event for a tool_call, opening the bubble if needed', () => {
    const t = turn();
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'Read file',
      rawInput: { file_path: '/a.ts' },
    };
    expect(translateSessionUpdate(update, t)).toEqual([
      { type: 'assistant_message_start', messageId: 'assistant-0' },
      { type: 'tool_use', messageId: 'assistant-0', toolUse: { id: 'tool-1', name: 'Read file', input: { file_path: '/a.ts' } } },
    ]);
  });

  it('falls back to the tool call id as the name when no title is given', () => {
    const t = turn();
    const update: SessionUpdate = { sessionUpdate: 'tool_call', toolCallId: 'tool-2', title: '' };
    const events = translateSessionUpdate(update, t);
    expect(events[1]).toMatchObject({ toolUse: { id: 'tool-2', name: 'tool-2' } });
  });

  it('skips a tool_call_update with no content and a non-terminal status', () => {
    const t = turn();
    t.messageId = 'assistant-0';
    const update: SessionUpdate = { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'in_progress' };
    expect(translateSessionUpdate(update, t)).toEqual([]);
  });

  it('emits a tool_result for a completed tool_call_update with content blocks', () => {
    const t = turn();
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'file body' } }],
    };
    expect(translateSessionUpdate(update, t)).toEqual([
      { type: 'assistant_message_start', messageId: 'assistant-0' },
      { type: 'tool_result', messageId: 'assistant-0', toolUseId: 'tool-1', result: 'file body', isError: false },
    ]);
  });

  it('marks a tool_result as an error for a failed tool_call_update', () => {
    const t = turn();
    const update: SessionUpdate = { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'failed', content: [] };
    const events = translateSessionUpdate(update, t);
    expect(events.at(-1)).toMatchObject({ type: 'tool_result', toolUseId: 'tool-1', isError: true });
  });

  it('renders a diff tool_call_update content block as a path + new text', () => {
    const t = turn();
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
      content: [{ type: 'diff', path: '/a.ts', newText: 'const x = 1;' }],
    };
    const events = translateSessionUpdate(update, t);
    expect(events.at(-1)).toMatchObject({ result: '/a.ts\nconst x = 1;' });
  });

  it('emits a tool_result for an in_progress update once content is present', () => {
    const t = turn();
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'in_progress',
      content: [{ type: 'content', content: { type: 'text', text: 'partial output' } }],
    };
    const events = translateSessionUpdate(update, t);
    expect(events.at(-1)).toMatchObject({ result: 'partial output', isError: false });
  });

  it('ignores plan and mode updates', () => {
    const t = turn();
    expect(translateSessionUpdate({ sessionUpdate: 'plan', entries: [] }, t)).toEqual([]);
    expect(translateSessionUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'code' }, t)).toEqual([]);
  });
});

describe('translatePermissionRequest', () => {
  it('translates a permission request into the renderer-facing event shape', () => {
    const params: RequestPermissionRequest = {
      sessionId: 'session-1',
      toolCall: { toolCallId: 'tool-1', title: 'Run rm -rf', rawInput: { command: 'rm -rf /tmp/x' } },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    };
    expect(translatePermissionRequest('req-1', params)).toEqual({
      type: 'permission_request',
      requestId: 'req-1',
      toolUse: { id: 'tool-1', name: 'Run rm -rf', input: { command: 'rm -rf /tmp/x' } },
      options: [
        { id: 'allow', name: 'Allow', kind: 'allow_once' },
        { id: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
  });
});

describe('toChatConfigOptions', () => {
  it('returns an empty array for a missing or empty option list', () => {
    expect(toChatConfigOptions(undefined)).toEqual([]);
    expect(toChatConfigOptions(null)).toEqual([]);
    expect(toChatConfigOptions([])).toEqual([]);
  });

  it('translates a flat select option (model choice)', () => {
    const options: SessionConfigOption[] = [
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'claude-opus-4-8',
        options: [
          { value: 'claude-opus-4-8', name: 'Opus 4.8' },
          { value: 'claude-sonnet-5', name: 'Sonnet 5' },
        ],
      },
    ];
    expect(toChatConfigOptions(options)).toEqual([
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        kind: 'select',
        currentValue: 'claude-opus-4-8',
        values: [
          { id: 'claude-opus-4-8', name: 'Opus 4.8' },
          { id: 'claude-sonnet-5', name: 'Sonnet 5' },
        ],
      },
    ]);
  });

  it('flattens a grouped select option, attaching the group name to each value', () => {
    const options: SessionConfigOption[] = [
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        currentValue: 'claude-sonnet-5',
        options: [
          { group: 'anthropic', name: 'Anthropic', options: [{ value: 'claude-sonnet-5', name: 'Sonnet 5' }] },
          { group: 'openai', name: 'OpenAI', options: [{ value: 'gpt-5', name: 'GPT-5' }] },
        ],
      },
    ];
    expect(toChatConfigOptions(options)[0]).toMatchObject({
      kind: 'select',
      values: [
        { id: 'claude-sonnet-5', name: 'Sonnet 5', group: 'Anthropic' },
        { id: 'gpt-5', name: 'GPT-5', group: 'OpenAI' },
      ],
    });
  });

  it('translates a boolean option', () => {
    const options: SessionConfigOption[] = [
      { type: 'boolean', id: 'fast-mode', name: 'Fast mode', currentValue: true },
    ];
    expect(toChatConfigOptions(options)).toEqual([
      { id: 'fast-mode', name: 'Fast mode', kind: 'boolean', currentValue: true },
    ]);
  });
});

describe('translateSessionUpdate — config_option_update', () => {
  it('emits a config_options event with the full updated option set', () => {
    const t = turn();
    const update: SessionUpdate = {
      sessionUpdate: 'config_option_update',
      configOptions: [{ type: 'boolean', id: 'fast-mode', name: 'Fast mode', currentValue: false }],
    };
    expect(translateSessionUpdate(update, t)).toEqual([
      { type: 'config_options', options: [{ id: 'fast-mode', name: 'Fast mode', kind: 'boolean', currentValue: false }] },
    ]);
    // config_option_update never opens an assistant message bubble.
    expect(t.messageId).toBeNull();
  });
});
