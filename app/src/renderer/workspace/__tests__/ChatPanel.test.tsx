// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatSessionEvent, ChatSessionExitEvent } from '@sproutgit/types';

const { chatStartMock, chatSendMock, chatStopMock, onChatStreamMock, onChatExitMock } = vi.hoisted(() => ({
  chatStartMock: vi.fn(),
  chatSendMock: vi.fn(),
  chatStopMock: vi.fn(),
  onChatStreamMock: vi.fn(),
  onChatExitMock: vi.fn(),
}));

vi.mock('../../api.js', () => ({
  api: {
    chatStart: (...args: unknown[]) => chatStartMock(...args),
    chatSend: (...args: unknown[]) => chatSendMock(...args),
    chatStop: (...args: unknown[]) => chatStopMock(...args),
    onChatStream: (...args: unknown[]) => onChatStreamMock(...args),
    onChatExit: (...args: unknown[]) => onChatExitMock(...args),
  },
}));

import { ChatPanel } from '../ChatPanel.js';

afterEach(() => { cleanup(); });

// jsdom doesn't implement Element.scrollTo — ChatPanel calls it to autoscroll
// the transcript on new messages.
beforeAll(() => {
  window.HTMLElement.prototype.scrollTo = () => undefined;
});

/** Captures the callback ChatPanel registers so a test can push a stream event into it, like the real IPC bridge would. */
function captureStreamCallback(): (payload: ChatSessionEvent) => void {
  const call = onChatStreamMock.mock.calls.at(-1);
  if (!call) throw new Error('onChatStream was not registered');
  return call[0] as (payload: ChatSessionEvent) => void;
}

function captureExitCallback(): (payload: ChatSessionExitEvent) => void {
  const call = onChatExitMock.mock.calls.at(-1);
  if (!call) throw new Error('onChatExit was not registered');
  return call[0] as (payload: ChatSessionExitEvent) => void;
}

/** Drains the microtask queue so a resolved promise's .then() chain (e.g. chatStart()'s) has run. */
function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onChatStreamMock.mockReturnValue(() => undefined);
    onChatExitMock.mockReturnValue(() => undefined);
    chatStopMock.mockResolvedValue(undefined);
    chatSendMock.mockResolvedValue(undefined);
  });

  it('shows the empty state and a disabled Send button before any message is sent', () => {
    render(<ChatPanel worktreePath="/ws/wt" />);
    expect(screen.getByText(/Chat with your configured AI agent/)).toBeTruthy();
    expect((screen.getByTestId('btn-chat-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sending a prompt calls chatStart with the worktreePath and prompt, and renders a user bubble', async () => {
    const user = userEvent.setup();
    chatStartMock.mockResolvedValue('session-1');
    render(<ChatPanel worktreePath="/ws/wt" />);

    await user.type(screen.getByTestId('input-chat-prompt'), 'Fix the bug');
    await user.click(screen.getByTestId('btn-chat-send'));

    expect(chatStartMock).toHaveBeenCalledWith({ worktreePath: '/ws/wt', prompt: 'Fix the bug' });
    const userBubbles = screen.getAllByTestId('chat-message').filter(el => el.getAttribute('data-role') === 'user');
    expect(userBubbles).toHaveLength(1);
    expect(screen.getByText('Fix the bug')).toBeTruthy();
  });

  it('a second message on the same session calls chatSend (not chatStart again) with the existing session id', async () => {
    const user = userEvent.setup();
    chatStartMock.mockResolvedValue('session-1');
    render(<ChatPanel worktreePath="/ws/wt" />);

    await user.type(screen.getByTestId('input-chat-prompt'), 'first');
    await user.click(screen.getByTestId('btn-chat-send'));
    await waitFor(() => expect(chatStartMock).toHaveBeenCalledTimes(1));

    // Simulate the turn completing (busy -> false). This must happen only
    // after chatStart()'s promise resolution has flushed (which sets
    // sessionIdRef.current) — otherwise the exit handler's sessionId-match
    // guard sees a still-null ref and no-ops. flushPromises() below drains
    // the microtask queue first.
    await flushPromises();
    const exitCb = captureExitCallback();
    exitCb({ sessionId: 'session-1', exitCode: 0 });
    await waitFor(() => expect((screen.getByTestId('btn-chat-send') as HTMLButtonElement).disabled).toBe(true));

    await user.type(screen.getByTestId('input-chat-prompt'), 'second');
    await user.click(screen.getByTestId('btn-chat-send'));

    expect(chatSendMock).toHaveBeenCalledWith({ sessionId: 'session-1', prompt: 'second' });
    expect(chatStartMock).toHaveBeenCalledTimes(1);
  });

  it('renders streamed assistant_text_delta events appended into the same message bubble', async () => {
    const user = userEvent.setup();
    chatStartMock.mockResolvedValue('session-1');
    render(<ChatPanel worktreePath="/ws/wt" />);

    await user.type(screen.getByTestId('input-chat-prompt'), 'hi');
    await user.click(screen.getByTestId('btn-chat-send'));
    await waitFor(() => expect(onChatStreamMock).toHaveBeenCalled());

    const streamCb = captureStreamCallback();
    streamCb({ sessionId: 'session-1', event: { type: 'assistant_message_start', messageId: 'assistant-0' } });
    streamCb({ sessionId: 'session-1', event: { type: 'assistant_text_delta', messageId: 'assistant-0', text: 'Hello ' } });
    streamCb({ sessionId: 'session-1', event: { type: 'assistant_text_delta', messageId: 'assistant-0', text: 'world' } });
    streamCb({ sessionId: 'session-1', event: { type: 'assistant_message_end', messageId: 'assistant-0' } });

    await waitFor(() => expect(screen.getByText('Hello world')).toBeTruthy());
  });

  it('ignores stream events for a stale/mismatched session id', async () => {
    const user = userEvent.setup();
    chatStartMock.mockResolvedValue('session-1');
    render(<ChatPanel worktreePath="/ws/wt" />);

    await user.type(screen.getByTestId('input-chat-prompt'), 'hi');
    await user.click(screen.getByTestId('btn-chat-send'));
    await waitFor(() => expect(onChatStreamMock).toHaveBeenCalled());

    const streamCb = captureStreamCallback();
    streamCb({ sessionId: 'some-other-session', event: { type: 'assistant_message_start', messageId: 'assistant-0' } });
    streamCb({ sessionId: 'some-other-session', event: { type: 'assistant_text_delta', messageId: 'assistant-0', text: 'should not appear' } });

    expect(screen.queryByText('should not appear')).toBeNull();
  });

  it('renders a tool_use block and attaches its tool_result once it arrives', async () => {
    const user = userEvent.setup();
    chatStartMock.mockResolvedValue('session-1');
    render(<ChatPanel worktreePath="/ws/wt" />);

    await user.type(screen.getByTestId('input-chat-prompt'), 'read a file');
    await user.click(screen.getByTestId('btn-chat-send'));
    await waitFor(() => expect(onChatStreamMock).toHaveBeenCalled());

    const streamCb = captureStreamCallback();
    streamCb({ sessionId: 'session-1', event: { type: 'assistant_message_start', messageId: 'assistant-0' } });
    streamCb({
      sessionId: 'session-1',
      event: { type: 'tool_use', messageId: 'assistant-0', toolUse: { id: 'tool-1', name: 'Read', input: { file_path: '/a.ts' } } },
    });
    streamCb({ sessionId: 'session-1', event: { type: 'assistant_message_end', messageId: 'assistant-0' } });

    await waitFor(() => expect(screen.getByTestId('chat-tool-use')).toBeTruthy());
    expect(screen.getByText('Read')).toBeTruthy();

    streamCb({ sessionId: 'session-1', event: { type: 'tool_result', messageId: '', toolUseId: 'tool-1', result: 'file body', isError: false } });
    await waitFor(() => expect(screen.getByText('file body')).toBeTruthy());
  });

  it('shows the error banner when a result event reports failure', async () => {
    const user = userEvent.setup();
    chatStartMock.mockResolvedValue('session-1');
    render(<ChatPanel worktreePath="/ws/wt" />);

    await user.type(screen.getByTestId('input-chat-prompt'), 'hi');
    await user.click(screen.getByTestId('btn-chat-send'));
    await waitFor(() => expect(onChatStreamMock).toHaveBeenCalled());

    const streamCb = captureStreamCallback();
    streamCb({ sessionId: 'session-1', event: { type: 'result', success: false, summary: 'The agent hit an internal error.' } });

    await waitFor(() => expect(screen.getByTestId('chat-error')).toBeTruthy());
    expect(screen.getByText('The agent hit an internal error.')).toBeTruthy();
  });

  it('shows an error banner when chatStart itself rejects', async () => {
    const user = userEvent.setup();
    chatStartMock.mockRejectedValue(new Error('Integrated mode is not enabled for the configured agent.'));
    render(<ChatPanel worktreePath="/ws/wt" />);

    await user.type(screen.getByTestId('input-chat-prompt'), 'hi');
    await user.click(screen.getByTestId('btn-chat-send'));

    await waitFor(() => expect(screen.getByTestId('chat-error')).toBeTruthy());
    expect(screen.getByText('Integrated mode is not enabled for the configured agent.')).toBeTruthy();
  });

  it('resets the transcript when worktreePath changes', async () => {
    const user = userEvent.setup();
    chatStartMock.mockResolvedValue('session-1');
    const { rerender } = render(<ChatPanel worktreePath="/ws/wt-a" />);

    await user.type(screen.getByTestId('input-chat-prompt'), 'hi from A');
    await user.click(screen.getByTestId('btn-chat-send'));
    expect(screen.getByText('hi from A')).toBeTruthy();

    rerender(<ChatPanel worktreePath="/ws/wt-b" />);
    expect(screen.queryByText('hi from A')).toBeNull();
    expect(screen.getByText(/Chat with your configured AI agent/)).toBeTruthy();
  });

  it('calls chatStop for the active session on unmount', async () => {
    const user = userEvent.setup();
    chatStartMock.mockResolvedValue('session-1');
    chatStopMock.mockResolvedValue(undefined);
    const { unmount } = render(<ChatPanel worktreePath="/ws/wt" />);

    await user.type(screen.getByTestId('input-chat-prompt'), 'hi');
    await user.click(screen.getByTestId('btn-chat-send'));
    await waitFor(() => expect(chatStartMock).toHaveBeenCalled());

    unmount();
    expect(chatStopMock).toHaveBeenCalledWith('session-1');
  });
});
