import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { resolveCommandPathMock } = vi.hoisted(() => ({ resolveCommandPathMock: vi.fn() }));
vi.mock('../tool-test-helpers.js', () => ({ resolveCommandPath: resolveCommandPathMock }));

import { acpAdapterInstallDir, resolveAcpAdapterBin } from '../acp-adapters.js';
import type { AcpPresetInfo } from '../agents.js';

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
