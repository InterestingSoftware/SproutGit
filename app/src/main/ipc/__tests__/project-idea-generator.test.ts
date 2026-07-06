import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handleMock, execFileMock, getAgentConfigMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  execFileMock: vi.fn(),
  getAgentConfigMock: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@sproutgit/database', () => ({
  getAgentRoster: () => ({
    agents: [{ id: 'a', name: 'Agent', env: {}, ...getAgentConfigMock() }],
    defaultAgentId: 'a',
  }),
  resolveRosterAgent: (roster: { agents: unknown[] }) => roster.agents[0],
}));
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));

import { registerProjectIdeaGeneratorHandlers } from '../project-idea-generator.js';

type Handler = (event: unknown, args: { pitch: string }) => Promise<unknown>;

function getRegisteredHandler(): Handler {
  registerProjectIdeaGeneratorHandlers({} as never);
  const call = handleMock.mock.calls.find(c => c[0] === 'projectIdea:generate');
  if (!call) throw new Error('projectIdea:generate handler was not registered');
  return call[1] as Handler;
}

function mockExecFileSuccess(stdout: string) {
  execFileMock.mockImplementation((_cmd, _args, _opts, callback: (...cbArgs: unknown[]) => void) => {
    callback(null, stdout, '');
    return { stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() } };
  });
}

describe('projectIdea:generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to run with an empty pitch', async () => {
    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: '   ' });
    expect(result).toEqual({ error: 'Describe your project idea first.' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('refuses to run when no agent is configured', async () => {
    getAgentConfigMock.mockReturnValue({ command: '', args: [], mode: 'terminal' });
    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: 'a cli tool' });
    expect(result).toEqual({ error: 'No AI agent configured. Set one in Settings → AI Agents.' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('falls back to spawning an unrecognized command as-is with the prompt piped over stdin', async () => {
    getAgentConfigMock.mockReturnValue({ command: 'cursor-agent', args: ['--flag'], mode: 'terminal' });
    const stdinWrite = vi.fn();
    const stdinEnd = vi.fn();
    execFileMock.mockImplementation((_cmd, _args, _opts, callback: (...cbArgs: unknown[]) => void) => {
      callback(null, '{"name": "a", "techStack": "b", "description": "c"}', '');
      return { stdin: { write: stdinWrite, end: stdinEnd, on: vi.fn() } };
    });

    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: 'a cli tool' });

    expect(result).toEqual({ name: 'a', techStack: 'b', description: 'c' });
    const [command, args] = execFileMock.mock.calls[0]!;
    expect(command).toBe('cursor-agent');
    expect(args).toEqual(['--flag']); // no flag guessed — the configured args are spawned verbatim
    expect(stdinWrite).toHaveBeenCalledWith(expect.stringContaining('a cli tool'));
    expect(stdinEnd).toHaveBeenCalled();
  });

  it('invokes Claude Code with -p and the pitch, parsing the JSON response', async () => {
    getAgentConfigMock.mockReturnValue({ command: 'claude', args: [], mode: 'terminal' });
    mockExecFileSuccess('{"name": "Release Notes CLI", "techStack": "Node.js + TypeScript", "description": "Turns changelogs into release notes."}');

    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: 'a cli that turns a changelog into release notes' });

    expect(result).toEqual({
      name: 'release-notes-cli',
      techStack: 'Node.js + TypeScript',
      description: 'Turns changelogs into release notes.',
    });

    const [command, args] = execFileMock.mock.calls[0]!;
    expect(command).toBe('claude');
    expect(args[0]).toBe('-p');
    expect(args[1]).toContain('a cli that turns a changelog into release notes');
  });

  it.each([
    ['gemini', ['-p']],
    ['codex', ['exec']],
    ['kiro', ['chat', '--no-interactive']],
  ])('maps %s to its verified non-interactive flags', async (command, expectedLeadingArgs) => {
    getAgentConfigMock.mockReturnValue({ command, args: [], mode: 'terminal' });
    mockExecFileSuccess('{"name": "a", "techStack": "b", "description": "c"}');

    const handler = getRegisteredHandler();
    await handler({}, { pitch: 'an idea' });

    const [, args] = execFileMock.mock.calls[0]!;
    expect(args.slice(0, expectedLeadingArgs.length)).toEqual(expectedLeadingArgs);
  });

  it('extracts a JSON object even when the agent wraps it in prose', async () => {
    getAgentConfigMock.mockReturnValue({ command: 'claude', args: [], mode: 'terminal' });
    mockExecFileSuccess('Sure! Here you go:\n{"name": "Foo Bar", "techStack": "Python", "description": "does foo"}\nHope that helps!');

    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: 'an idea' });

    expect(result).toEqual({ name: 'foo-bar', techStack: 'Python', description: 'does foo' });
  });

  it('slugifies a name with characters unsafe for a folder/branch name', async () => {
    getAgentConfigMock.mockReturnValue({ command: 'claude', args: [], mode: 'terminal' });
    mockExecFileSuccess('{"name": "My Cool App!! 2.0", "techStack": "x", "description": "y"}');

    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: 'an idea' });

    expect(result).toEqual({ name: 'my-cool-app-2-0', techStack: 'x', description: 'y' });
  });

  it('errors when the agent does not return usable JSON', async () => {
    getAgentConfigMock.mockReturnValue({ command: 'claude', args: [], mode: 'terminal' });
    mockExecFileSuccess('not json at all');

    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: 'an idea' });

    expect(result).toEqual({ error: 'The agent did not return a usable response.' });
  });

  it('errors when the parsed JSON is missing expected fields', async () => {
    getAgentConfigMock.mockReturnValue({ command: 'claude', args: [], mode: 'terminal' });
    mockExecFileSuccess('{"name": "foo"}');

    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: 'an idea' });

    expect(result).toEqual({ error: 'The agent response was missing expected fields.' });
  });

  it('reports a timeout as a distinct error', async () => {
    getAgentConfigMock.mockReturnValue({ command: 'claude', args: [], mode: 'terminal' });
    execFileMock.mockImplementation((_cmd, _args, _opts, callback: (...cbArgs: unknown[]) => void) => {
      const err = Object.assign(new Error('killed'), { killed: true });
      callback(err, '', '');
      return { stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() } };
    });

    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: 'an idea' });
    expect(result).toEqual({ error: 'Timed out after 60s.' });
  });

  it('surfaces stderr when the command exits non-zero', async () => {
    getAgentConfigMock.mockReturnValue({ command: 'claude', args: [], mode: 'terminal' });
    execFileMock.mockImplementation((_cmd, _args, _opts, callback: (...cbArgs: unknown[]) => void) => {
      callback(new Error('exit 1'), '', 'auth error: not logged in\n');
      return { stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() } };
    });

    const handler = getRegisteredHandler();
    const result = await handler({}, { pitch: 'an idea' });
    expect(result).toEqual({ error: 'auth error: not logged in' });
  });
});
