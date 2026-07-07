import { useEffect, useRef, useState } from 'react';
import { Bot, User, Wrench, Send, Loader2, ShieldQuestion, SlidersHorizontal } from 'lucide-react';
import { ModelPicker, type ModelPickerGroup } from '@sproutgit/ui';
import { api } from '../api.js';
import type { ChatConfigOption, ChatMessage, ChatPermissionRequest, ChatStreamEvent, ChatToolUse } from '@sproutgit/types';

type Props = {
  worktreePath: string;
  /** Sent automatically once, as if the user had typed and submitted it, the first time this panel mounts for `worktreePath` — used to kick off boilerplate scaffolding right after a new project is created. */
  autoPrompt?: string;
};

/**
 * Integrated AI agent chat — spawns the configured agent's Agent Client
 * Protocol (ACP) mode and renders the translated session updates as a proper
 * chat UI: streamed assistant bubbles, a prompt input at the bottom,
 * tool-use/tool-result content rendered distinctly rather than as raw
 * terminal text, and inline permission-request prompts when the agent asks
 * for authorization before running a tool.
 */
export function ChatPanel({ worktreePath, autoPrompt }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<ChatPermissionRequest | null>(null);
  const [configOptions, setConfigOptions] = useState<ChatConfigOption[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Tracks the worktreePath an autoPrompt has already been sent for, so it
  // fires exactly once per worktree — not on every render where autoPrompt
  // happens to be truthy, and not again if the user switches away and back.
  const autoPromptSentForRef = useRef<string | null>(null);

  useEffect(() => {
    // A Chat panel is scoped to one worktree — reset transcript when it changes.
    setMessages([]);
    sessionIdRef.current = null;
    setError(null);
    setPendingPermission(null);
    setConfigOptions([]);
    // A message could have been in flight when the user switched worktrees —
    // without this, `busy` stays true and blocks every send (including an
    // autoPrompt) in the worktree just switched to.
    setBusy(false);
  }, [worktreePath]);

  useEffect(() => {
    // autoPrompt can arrive as a prop update after this panel has already
    // mounted (e.g. the parent sets it in its own effect, which — since
    // child effects run before parent effects — fires after this component's
    // first render for a fresh worktree) — so this can't be a mount-only
    // effect keyed just on worktreePath; it must react to autoPrompt itself.
    if (!autoPrompt) return;
    if (autoPromptSentForRef.current === worktreePath) return;
    autoPromptSentForRef.current = worktreePath;
    void send(autoPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt, worktreePath]);

  useEffect(() => {
    const offStream = api.onChatStream(({ sessionId: sid, event }) => {
      if (sid !== sessionIdRef.current) return;
      applyStreamEvent(event);
    });
    const offExit = api.onChatExit(({ sessionId: sid }) => {
      if (sid !== sessionIdRef.current) return;
      sessionIdRef.current = null;
      setBusy(false);
      setPendingPermission(null);
      setConfigOptions([]);
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
      case 'permission_request':
        setPendingPermission({ requestId: event.requestId, toolUse: event.toolUse, options: event.options });
        break;
      case 'config_options':
        setConfigOptions(event.options);
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

  async function respondToPermission(optionId: string) {
    if (!pendingPermission || !sessionIdRef.current) return;
    const { requestId } = pendingPermission;
    setPendingPermission(null);
    try {
      await api.chatRespondPermission({ sessionId: sessionIdRef.current, requestId, optionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function send(overrideText?: string) {
    const trimmed = (overrideText ?? prompt).trim();
    if (!trimmed || busy) return;
    setError(null);
    if (overrideText === undefined) setPrompt('');
    setMessages(prev => [...prev, { id: `user-${prev.length}`, role: 'user', text: trimmed, toolUses: [], streaming: false }]);
    setBusy(true);
    try {
      if (!sessionIdRef.current) {
        const { sessionId, configOptions: initialConfigOptions } = await api.chatStart({ worktreePath, initialPrompt: trimmed });
        sessionIdRef.current = sessionId;
        setConfigOptions(initialConfigOptions);
      } else {
        await api.chatSend({ sessionId: sessionIdRef.current, prompt: trimmed });
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function setConfigOption(configId: string, value: string | boolean) {
    if (!sessionIdRef.current) return;
    try {
      const updated = await api.chatSetConfigOption({ sessionId: sessionIdRef.current, configId, value });
      setConfigOptions(updated);
    } catch (err) {
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
        {pendingPermission && (
          <PermissionRequestCard request={pendingPermission} onRespond={optionId => void respondToPermission(optionId)} />
        )}
        {error && (
          <div className="rounded border border-(--sg-danger)/30 bg-(--sg-danger)/8 px-3 py-2 text-xs text-(--sg-danger)" data-testid="chat-error">
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-(--sg-border) bg-(--sg-surface) p-3">
        {configOptions.length > 0 && (
          <ConfigOptionsBar options={configOptions} onChange={(configId, value) => void setConfigOption(configId, value)} />
        )}
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

/** Buttons matching an option's `PermissionOptionKind` — allow options lean on the primary accent, reject options on danger. */
function permissionOptionClasses(kind: ChatPermissionRequest['options'][number]['kind']): string {
  if (kind === 'allow_once' || kind === 'allow_always') {
    return 'border-none bg-(--sg-primary) text-white hover:bg-(--sg-primary-hover)';
  }
  return 'border border-(--sg-danger)/40 text-(--sg-danger) hover:bg-(--sg-danger)/10';
}

function PermissionRequestCard({ request, onRespond }: { request: ChatPermissionRequest; onRespond: (optionId: string) => void }) {
  return (
    <div className="rounded-lg border border-(--sg-border) bg-(--sg-surface-raised) px-3 py-2.5" data-testid="chat-permission-request">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-(--sg-text-dim)">
        <ShieldQuestion size={12} /> Permission requested
      </div>
      <p className="mt-1 text-xs text-(--sg-text)">
        The agent wants to run <span className="font-medium">{request.toolUse.name}</span>.
      </p>
      <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded border border-(--sg-border) bg-(--sg-bg) px-2 py-1.5 font-mono text-[10px] text-(--sg-text-faint)">
        {JSON.stringify(request.toolUse.input, null, 2)}
      </pre>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {request.options.map(option => (
          <button
            key={option.id}
            type="button"
            className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium ${permissionOptionClasses(option.kind)}`}
            onClick={() => onRespond(option.id)}
            data-testid="btn-chat-permission-option"
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Groups an agent's flat `values` list into `ModelPickerGroup`s using each
 * value's own `group` label (ACP `SessionConfigSelectGroup`, flattened onto
 * `ChatConfigOptionValue.group`); ungrouped values fall into one catch-all
 * group named after the option itself.
 */
function buildModelGroups(option: Extract<ChatConfigOption, { kind: 'select' }>): ModelPickerGroup[] {
  const groupsByLabel = new Map<string, ModelPickerGroup>();
  for (const v of option.values) {
    const groupLabel = v.group ?? option.name;
    let group = groupsByLabel.get(groupLabel);
    if (!group) {
      group = { groupId: groupLabel, groupLabel, models: [] };
      groupsByLabel.set(groupLabel, group);
    }
    group.models.push({ id: v.id, label: v.name, ...(v.description ? { description: v.description } : {}) });
  }
  return [...groupsByLabel.values()];
}

/**
 * Agent-exposed session settings (ACP `session/set_config_option`) — model
 * choice is the main example (category `"model"`), rendered with the shared
 * searchable `ModelPicker` (agent-provided options only: for ACP agents the
 * agent itself owns its model list, this doesn't mix in the AI provider
 * registry from Settings). Other select/boolean options agents can expose
 * still render as a plain dropdown/toggle.
 */
function ConfigOptionsBar({ options, onChange }: { options: ChatConfigOption[]; onChange: (configId: string, value: string | boolean) => void }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="chat-config-options">
      <SlidersHorizontal size={11} className="text-(--sg-text-faint)" />
      {options.map(option => (
        option.kind === 'select' && option.category === 'model' ? (
          <label key={option.id} className="flex items-center gap-1 text-[11px] text-(--sg-text-dim)" title={option.description}>
            {option.name}:
            <div className="w-48" data-testid={`chat-config-select-${option.id}`}>
              <ModelPicker
                groups={buildModelGroups(option)}
                value={option.currentValue}
                onChange={value => onChange(option.id, value)}
                className="text-[11px]"
              />
            </div>
          </label>
        ) : option.kind === 'select' ? (
          <label key={option.id} className="flex items-center gap-1 text-[11px] text-(--sg-text-dim)" title={option.description}>
            {option.name}:
            <select
              value={option.currentValue}
              onChange={e => onChange(option.id, e.target.value)}
              className="rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-1.5 py-0.5 text-[11px] text-(--sg-text)"
              data-testid={`chat-config-select-${option.id}`}
            >
              {option.values.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <button
            key={option.id}
            type="button"
            title={option.description}
            className={`rounded border px-2 py-0.5 text-[11px] cursor-pointer ${option.currentValue ? 'border-(--sg-primary) text-(--sg-primary)' : 'border-(--sg-border) text-(--sg-text-dim)'}`}
            onClick={() => onChange(option.id, !option.currentValue)}
            data-testid={`chat-config-toggle-${option.id}`}
          >
            {option.name}
          </button>
        )
      ))}
    </div>
  );
}
