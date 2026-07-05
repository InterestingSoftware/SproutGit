/**
 * Integration test against a *real* ACP agent process — not a mock/stub.
 * `@agentclientprotocol/sdk` (an existing dependency) ships a minimal example
 * agent at dist/examples/agent.js that requires no credentials and walks
 * through text streaming, a no-permission tool call, and a permission-gated
 * tool call. Spawning it for real and driving it through the exact
 * `translateSessionUpdate`/`translatePermissionRequest` functions chat.ts
 * uses in production proves the ACP wiring works end to end, not just that
 * each half works in isolation against hand-built fixtures.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { join } from 'node:path';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type Client, type RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { ChatPermissionRequest, ChatStreamEvent, ChatToolUse } from '@sproutgit/types';
import { translatePermissionRequest, translateSessionUpdate, type TurnState } from '../chat-acp-events.js';

const EXAMPLE_AGENT_PATH = join(process.cwd(), 'node_modules/@agentclientprotocol/sdk/dist/examples/agent.js');

function textOf(events: ChatStreamEvent[]): string {
  return events
    .filter((e): e is Extract<ChatStreamEvent, { type: 'assistant_text_delta' }> => e.type === 'assistant_text_delta')
    .map(e => e.text)
    .join('');
}

function toolUseOf(events: ChatStreamEvent[]): ChatToolUse[] {
  return events
    .filter((e): e is Extract<ChatStreamEvent, { type: 'tool_use' }> => e.type === 'tool_use')
    .map(e => e.toolUse);
}

function permissionRequestsOf(events: ChatStreamEvent[]): ChatPermissionRequest[] {
  return events
    .filter((e): e is Extract<ChatStreamEvent, { type: 'permission_request' }> => e.type === 'permission_request')
    .map(e => ({ requestId: e.requestId, toolUse: e.toolUse, options: e.options }));
}

describe('chat ACP integration (real example agent process)', () => {
  let child: ChildProcessWithoutNullStreams | undefined;

  afterEach(() => {
    child?.kill();
    child = undefined;
  });

  it('streams text, tool calls, and a permission request, all translated into ChatStreamEvents — allowing the sensitive change', async () => {
    child = spawn(process.execPath, [EXAMPLE_AGENT_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));

    const events: ChatStreamEvent[] = [];
    const turn: TurnState = { messageId: null, messageIdSeq: { current: 0 } };

    const client: Client = {
      sessionUpdate: notification => {
        events.push(...translateSessionUpdate(notification.update, turn));
      },
      requestPermission: params => {
        events.push(translatePermissionRequest('test-request', params));
        const allowOption = params.options.find(o => o.kind === 'allow_once');
        if (!allowOption) throw new Error('example agent did not offer an allow_once option');
        return Promise.resolve<RequestPermissionResponse>({ outcome: { outcome: 'selected', optionId: allowOption.optionId } });
      },
    };

    const connection = new ClientSideConnection(() => client, stream);
    await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const { sessionId } = await connection.newSession({ cwd: process.cwd(), mcpServers: [] });

    const response = await connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'Please make the change.' }] });

    expect(response.stopReason).toBe('end_turn');
    expect(textOf(events)).toContain("I'll help you with that");
    expect(textOf(events)).toContain("Perfect! I've successfully updated the configuration");

    const toolUses = toolUseOf(events);
    expect(toolUses.find(t => t.name === 'Reading project files')).toBeTruthy();

    const call1Result = events.find(
      (e): e is Extract<ChatStreamEvent, { type: 'tool_result' }> => e.type === 'tool_result' && e.toolUseId === 'call_1',
    );
    expect(call1Result?.result).toContain('# My Project');

    const permissionRequests = permissionRequestsOf(events);
    expect(permissionRequests).toHaveLength(1);
    expect(permissionRequests[0]).toMatchObject({
      toolUse: { id: 'call_2', name: 'Modifying critical configuration file' },
      options: [
        { name: 'Allow this change', kind: 'allow_once' },
        { name: 'Skip this change', kind: 'reject_once' },
      ],
    });
  }, 15_000);

  it('reports the rejection path when the user declines the sensitive tool call', async () => {
    child = spawn(process.execPath, [EXAMPLE_AGENT_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));

    const events: ChatStreamEvent[] = [];
    const turn: TurnState = { messageId: null, messageIdSeq: { current: 0 } };

    const client: Client = {
      sessionUpdate: notification => {
        events.push(...translateSessionUpdate(notification.update, turn));
      },
      requestPermission: params => {
        const rejectOption = params.options.find(o => o.kind === 'reject_once');
        if (!rejectOption) throw new Error('example agent did not offer a reject_once option');
        return Promise.resolve<RequestPermissionResponse>({ outcome: { outcome: 'selected', optionId: rejectOption.optionId } });
      },
    };

    const connection = new ClientSideConnection(() => client, stream);
    await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const { sessionId } = await connection.newSession({ cwd: process.cwd(), mcpServers: [] });
    const response = await connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'Please make the change.' }] });

    expect(response.stopReason).toBe('end_turn');
    expect(textOf(events)).toContain('I understand you prefer not to make that change');
  }, 15_000);
});
