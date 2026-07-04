import { useEffect, useRef, useState } from 'react';
import { Bot, User, Wrench, Send, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import type { ChatMessage, ChatStreamEvent, ChatToolUse } from '@sproutgit/types';

type Props = {
  worktreePath: string;
};

/**
 * Integrated AI agent chat — spawns the configured agent (Claude Code, in
 * Integrated mode) with structured streaming output and renders the parsed
 * stream as a proper chat UI: streamed assistant bubbles, a prompt input at
 * the bottom, and tool-use/tool-result content rendered distinctly rather
 * than as raw terminal text.
 */
export function ChatPanel({ worktreePath }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    // A Chat panel is scoped to one worktree — reset transcript when it changes.
    setMessages([]);
    sessionIdRef.current = null;
    setError(null);
  }, [worktreePath]);

  useEffect(() => {
    const offStream = api.onChatStream(({ sessionId: sid, event }) => {
      if (sid !== sessionIdRef.current) return;
      applyStreamEvent(event);
    });
    const offExit = api.onChatExit(({ sessionId: sid }) => {
      if (sid !== sessionIdRef.current) return;
      setBusy(false);
    });
    return () => { offStream(); offExit(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function applyStreamEvent(event: ChatStreamEvent) {
    switch (event.type) {
      case 'assistant_message_start':
        setMessages(prev => [...prev, { id: event.messageId, role: 'assistant', text: '', toolUses: [], streaming: true }]);
        break;
      case 'assistant_text_delta':
        setMessages(prev => prev.map(m => m.id === event.messageId ? { ...m, text: m.text + event.text } : m));
        break;
      case 'tool_use':
        setMessages(prev => prev.map(m => m.id === event.messageId ? { ...m, toolUses: [...m.toolUses, event.toolUse] } : m));
        break;
      case 'tool_result':
        setMessages(prev => prev.map(m => ({
          ...m,
          toolUses: m.toolUses.map(t => t.id === event.toolUseId ? { ...t, result: event.result, isError: event.isError } : t),
        })));
        break;
      case 'assistant_message_end':
        setMessages(prev => prev.map(m => m.id === event.messageId ? { ...m, streaming: false } : m));
        break;
      case 'result':
        setBusy(false);
        if (!event.success) setError(event.summary || 'The agent reported an error.');
        break;
      case 'error':
        setBusy(false);
        setError(event.message);
        break;
    }
  }

  async function send() {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setError(null);
    setPrompt('');
    setMessages(prev => [...prev, { id: `user-${prev.length}`, role: 'user', text: trimmed, toolUses: [], streaming: false }]);
    setBusy(true);
    try {
      if (!sessionIdRef.current) {
        const id = await api.chatStart({ worktreePath, prompt: trimmed });
        sessionIdRef.current = id;
      } else {
        await api.chatSend({ sessionId: sessionIdRef.current, prompt: trimmed });
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    return () => {
      if (sessionIdRef.current) void api.chatStop(sessionIdRef.current).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreePath]);

  return (
    <div className="flex h-full flex-col" data-testid="chat-panel">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-sm space-y-2">
              <Bot size={24} className="mx-auto text-(--sg-text-faint)" />
              <p className="text-xs text-(--sg-text-dim)">
                Chat with your configured AI agent in Integrated mode. Responses stream in as structured messages, with tool use shown distinctly.
              </p>
            </div>
          </div>
        )}
        {messages.map(m => (
          <ChatBubble key={m.id} message={m} />
        ))}
        {error && (
          <div className="rounded border border-(--sg-danger)/30 bg-(--sg-danger)/8 px-3 py-2 text-xs text-(--sg-danger)" data-testid="chat-error">
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-(--sg-border) bg-(--sg-surface) p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Message the AI agent…"
            className="min-w-0 flex-1 resize-none rounded-md border border-(--sg-input-border) bg-(--sg-input-bg) px-3 py-2 text-xs text-(--sg-text)"
            data-testid="input-chat-prompt"
            disabled={busy}
          />
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-(--sg-primary) px-3 py-2 text-xs font-medium text-white hover:bg-(--sg-primary-hover) disabled:opacity-50 cursor-pointer border-none"
            onClick={() => void send()}
            disabled={busy || !prompt.trim()}
            data-testid="btn-chat-send"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {busy ? 'Working…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`} data-testid="chat-message" data-role={message.role}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${isUser ? 'bg-(--sg-primary) text-white' : 'bg-(--sg-surface-raised) text-(--sg-text)'}`}>
        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {isUser ? <User size={10} /> : <Bot size={10} />}
          {isUser ? 'You' : 'Agent'}
          {message.streaming && <Loader2 size={10} className="animate-spin" />}
        </div>
        {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
        {message.toolUses.map(t => (
          <ToolUseBlock key={t.id} toolUse={t} />
        ))}
      </div>
    </div>
  );
}

function ToolUseBlock({ toolUse }: { toolUse: ChatToolUse }) {
  return (
    <div className="mt-2 rounded border border-(--sg-border) bg-(--sg-bg) px-2 py-1.5" data-testid="chat-tool-use">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-(--sg-text-dim)">
        <Wrench size={10} /> {toolUse.name}
      </div>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-(--sg-text-faint)">
        {JSON.stringify(toolUse.input, null, 2)}
      </pre>
      {toolUse.result !== undefined && (
        <div className={`mt-1 rounded px-1.5 py-1 font-mono text-[10px] ${toolUse.isError ? 'bg-(--sg-danger)/10 text-(--sg-danger)' : 'bg-(--sg-primary)/8 text-(--sg-text-dim)'}`}>
          {toolUse.result.length > 500 ? `${toolUse.result.slice(0, 500)}…` : toolUse.result}
        </div>
      )}
    </div>
  );
}
