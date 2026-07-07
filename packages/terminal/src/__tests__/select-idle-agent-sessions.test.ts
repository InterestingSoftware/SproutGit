import { describe, it, expect } from 'vitest';
import { selectIdleAgentSessions, type SessionMeta } from '../terminal-manager.js';

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    cwd: '/repo/worktree-a',
    label: 'AI Agent',
    agentId: 'agent',
    agentName: 'claude',
    startedAt: 0,
    ...overrides,
  };
}

describe('selectIdleAgentSessions', () => {
  it('includes an idle session that was agent-launched', () => {
    const meta = new Map([['a', makeMeta()]]);
    expect(selectIdleAgentSessions(['a'], meta)).toEqual([{ id: 'a', meta: meta.get('a') }]);
  });

  it('excludes a plain (non-agent) terminal sitting idle at a prompt', () => {
    const meta = new Map([['a', makeMeta({ agentId: null, agentName: null })]]);
    expect(selectIdleAgentSessions(['a'], meta)).toEqual([]);
  });

  it('excludes an idle id with no known metadata (already exited)', () => {
    const meta = new Map<string, SessionMeta>();
    expect(selectIdleAgentSessions(['gone'], meta)).toEqual([]);
  });

  it('filters a mixed batch down to only the agent-launched sessions', () => {
    const meta = new Map([
      ['agent-1', makeMeta({ cwd: '/repo/a' })],
      ['shell-1', makeMeta({ agentId: null, agentName: null, cwd: '/repo/b' })],
    ]);
    expect(selectIdleAgentSessions(['agent-1', 'shell-1'], meta)).toEqual([
      { id: 'agent-1', meta: meta.get('agent-1') },
    ]);
  });
});
