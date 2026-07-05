import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { resolveCommandPathMock, spawnMock, getAppPathMock } = vi.hoisted(() => ({
  resolveCommandPathMock: vi.fn(),
  spawnMock: vi.fn(),
  getAppPathMock: vi.fn(),
}));
vi.mock('../tool-test-helpers.js', () => ({ resolveCommandPath: resolveCommandPathMock }));
vi.mock('electron', () => ({ app: { getAppPath: getAppPathMock } }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { acpAdapterInstallDir, installAcpAdapter, resolveAcpAdapterBin } from '../acp-adapters.js';
import type { AcpPresetInfo } from '../agents.js';

/** A minimal fake child_process.ChildProcess: stdout/stderr emitters plus exit/error events. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

const spec: AcpPresetInfo = { bin: 'claude-agent-acp', args: [], label: 'Claude Code', npmPackage: '@agentclientprotocol/claude-agent-acp' };

describe('resolveAcpAdapterBin', () => {
  let userDataPath: string;

  beforeEach(() => {
    resolveCommandPathMock.mockReset();
    userDataPath = mkdtempSync(join(tmpdir(), 'sg-acp-adapter-'));
  });

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true });
  });

  it('prefers a PATH-resolved binary over any on-demand install', async () => {
    resolveCommandPathMock.mockResolvedValue('/usr/local/bin/claude-agent-acp');
    expect(await resolveAcpAdapterBin(userDataPath, spec)).toBe('/usr/local/bin/claude-agent-acp');
  });

  it('falls back to a previously on-demand-installed copy when not on PATH', async () => {
    resolveCommandPathMock.mockResolvedValue(null);
    const binDir = join(acpAdapterInstallDir(userDataPath, spec.npmPackage!), 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, 'claude-agent-acp');
    writeFileSync(binPath, '#!/usr/bin/env node\n');

    expect(await resolveAcpAdapterBin(userDataPath, spec)).toBe(binPath);
  });

  it('returns null when neither PATH nor an on-demand install has it', async () => {
    resolveCommandPathMock.mockResolvedValue(null);
    expect(await resolveAcpAdapterBin(userDataPath, spec)).toBeNull();
  });

  it('returns null for a native preset with no npmPackage, even if a same-named install dir exists', async () => {
    resolveCommandPathMock.mockResolvedValue(null);
    const nativeSpec: AcpPresetInfo = { bin: 'gemini', args: ['--acp'], label: 'Gemini CLI' };
    expect(await resolveAcpAdapterBin(userDataPath, nativeSpec)).toBeNull();
  });
});

describe('installAcpAdapter', () => {
  let userDataPath: string;
  let appRoot: string;

  beforeEach(() => {
    resolveCommandPathMock.mockReset();
    spawnMock.mockReset();
    getAppPathMock.mockReset();
    userDataPath = mkdtempSync(join(tmpdir(), 'sg-acp-install-'));
    appRoot = mkdtempSync(join(tmpdir(), 'sg-acp-approot-'));
    getAppPathMock.mockReturnValue(appRoot);
  });

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("pins the install to the version declared in the app's own package.json", async () => {
    writeFileSync(join(appRoot, 'package.json'), JSON.stringify({
      dependencies: { '@agentclientprotocol/claude-agent-acp': '^0.55.0' },
    }));
    resolveCommandPathMock.mockResolvedValue('/usr/local/bin/npm');
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const done = installAcpAdapter(userDataPath, '@agentclientprotocol/claude-agent-acp', () => undefined);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.emit('exit', 0);
    await done;

    const [, spawnArgs] = spawnMock.mock.calls[0]!;
    expect(spawnArgs).toContain('@agentclientprotocol/claude-agent-acp@^0.55.0');
  });

  it('falls back to an unpinned install when the package has no declared version (should not happen in practice)', async () => {
    writeFileSync(join(appRoot, 'package.json'), JSON.stringify({ dependencies: {} }));
    resolveCommandPathMock.mockResolvedValue('/usr/local/bin/npm');
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const done = installAcpAdapter(userDataPath, '@agentclientprotocol/codex-acp', () => undefined);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.emit('exit', 0);
    await done;

    const [, spawnArgs] = spawnMock.mock.calls[0]!;
    expect(spawnArgs).toContain('@agentclientprotocol/codex-acp');
    expect(spawnArgs).not.toContain('@agentclientprotocol/codex-acp@undefined');
  });
});
