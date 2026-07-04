import { describe, it, expect } from 'vitest';
import { parseStreamJsonLine } from '../chat-stream-parser.js';

function seq(start = 0): { current: number } {
  return { current: start };
}

describe('parseStreamJsonLine', () => {
  it('returns no events for an empty or whitespace-only line', () => {
    expect(parseStreamJsonLine('', seq())).toEqual([]);
    expect(parseStreamJsonLine('   \n', seq())).toEqual([]);
  });

  it('returns no events for malformed JSON, without throwing', () => {
    expect(() => parseStreamJsonLine('{not valid json', seq())).not.toThrow();
    expect(parseStreamJsonLine('{not valid json', seq())).toEqual([]);
  });

  it('returns no events for valid JSON that is not an object (string/number/array/null)', () => {
    expect(parseStreamJsonLine('"just a string"', seq())).toEqual([]);
    expect(parseStreamJsonLine('42', seq())).toEqual([]);
    expect(parseStreamJsonLine('null', seq())).toEqual([]);
    expect(parseStreamJsonLine('[1,2,3]', seq())).toEqual([]);
  });

  it('ignores an unrecognized/system message type', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' });
    expect(parseStreamJsonLine(line, seq())).toEqual([]);
  });

  it('parses an assistant message with a single text block into start/delta/end', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello there' }] },
    });
    const events = parseStreamJsonLine(line, seq());
    expect(events).toEqual([
      { type: 'assistant_message_start', messageId: 'assistant-0' },
      { type: 'assistant_text_delta', messageId: 'assistant-0', text: 'Hello there' },
      { type: 'assistant_message_end', messageId: 'assistant-0' },
    ]);
  });

  it('parses an assistant message with a tool_use block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/a.ts' } }],
      },
    });
    const events = parseStreamJsonLine(line, seq());
    expect(events).toEqual([
      { type: 'assistant_message_start', messageId: 'assistant-0' },
      { type: 'tool_use', messageId: 'assistant-0', toolUse: { id: 'tool-1', name: 'Read', input: { file_path: '/a.ts' } } },
      { type: 'assistant_message_end', messageId: 'assistant-0' },
    ]);
  });

  it('parses an assistant message with mixed text and tool_use blocks, in order', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me check that file.' },
          { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/b.ts' } },
        ],
      },
    });
    const events = parseStreamJsonLine(line, seq());
    expect(events.map(e => e.type)).toEqual([
      'assistant_message_start',
      'assistant_text_delta',
      'tool_use',
      'assistant_message_end',
    ]);
  });

  it('increments messageId across successive assistant messages using the shared sequence', () => {
    const messageIdSeq = seq();
    const first = parseStreamJsonLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'one' }] } }), messageIdSeq);
    const second = parseStreamJsonLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'two' }] } }), messageIdSeq);
    expect(first[0]).toEqual({ type: 'assistant_message_start', messageId: 'assistant-0' });
    expect(second[0]).toEqual({ type: 'assistant_message_start', messageId: 'assistant-1' });
  });

  it('treats an assistant message with no content array as an empty-body message (start + end only)', () => {
    const line = JSON.stringify({ type: 'assistant', message: {} });
    const events = parseStreamJsonLine(line, seq());
    expect(events).toEqual([
      { type: 'assistant_message_start', messageId: 'assistant-0' },
      { type: 'assistant_message_end', messageId: 'assistant-0' },
    ]);
  });

  it('ignores unrecognized content block types within an assistant message', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', text: 'internal reasoning' }] },
    });
    const events = parseStreamJsonLine(line, seq());
    expect(events).toEqual([
      { type: 'assistant_message_start', messageId: 'assistant-0' },
      { type: 'assistant_message_end', messageId: 'assistant-0' },
    ]);
  });

  it('parses a user message echoing a string tool_result', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents here', is_error: false }],
      },
    });
    const events = parseStreamJsonLine(line, seq());
    expect(events).toEqual([
      { type: 'tool_result', messageId: '', toolUseId: 'tool-1', result: 'file contents here', isError: false },
    ]);
  });

  it('parses a user message echoing an array-shaped tool_result content, concatenating text blocks', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-3',
          content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }],
          is_error: true,
        }],
      },
    });
    const events = parseStreamJsonLine(line, seq());
    expect(events).toEqual([
      { type: 'tool_result', messageId: '', toolUseId: 'tool-3', result: 'line one\nline two', isError: true },
    ]);
  });

  it('defaults isError to false when is_error is absent on a tool_result', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-4', content: 'ok' }] },
    });
    const events = parseStreamJsonLine(line, seq());
    expect(events[0]).toMatchObject({ isError: false });
  });

  it('ignores a user message with no tool_result blocks', () => {
    const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'echoed prompt' }] } });
    expect(parseStreamJsonLine(line, seq())).toEqual([]);
  });

  it('ignores a tool_result block missing a string tool_use_id', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'ok' }] },
    });
    expect(parseStreamJsonLine(line, seq())).toEqual([]);
  });

  it('parses a successful result message', () => {
    const line = JSON.stringify({ type: 'result', is_error: false, result: 'All done.' });
    expect(parseStreamJsonLine(line, seq())).toEqual([{ type: 'result', success: true, summary: 'All done.' }]);
  });

  it('parses a failed result message', () => {
    const line = JSON.stringify({ type: 'result', is_error: true, result: 'Something broke.' });
    expect(parseStreamJsonLine(line, seq())).toEqual([{ type: 'result', success: false, summary: 'Something broke.' }]);
  });

  it('defaults the result summary to an empty string when result is not a string', () => {
    const line = JSON.stringify({ type: 'result', is_error: false });
    expect(parseStreamJsonLine(line, seq())).toEqual([{ type: 'result', success: true, summary: '' }]);
  });

  it('handles a partial/truncated line (invalid JSON fragment) without throwing, yielding no events', () => {
    // Simulates a line split mid-stream by a naive readline buffering bug.
    const partial = '{"type":"assistant","message":{"content":[{"type":"text","text":"Hel';
    expect(() => parseStreamJsonLine(partial, seq())).not.toThrow();
    expect(parseStreamJsonLine(partial, seq())).toEqual([]);
  });
});
