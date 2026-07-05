// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { McpServerStatus } from '@sproutgit/types';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    mcpStatus: vi.fn(),
    mcpSetEnabled: vi.fn(),
    mcpSetPort: vi.fn(),
    mcpWriteClientConfig: vi.fn(),
    mcpGetManualSnippet: vi.fn(),
  },
}));
vi.mock('../../api.js', () => ({ api: apiMock }));

import { McpSection } from '../McpSection.js';

const WORKSPACE_PATH = '/tmp/some-workspace';

function disabledStatus(port = 45123): McpServerStatus {
  return { enabled: false, running: false, port };
}

function enabledRunningStatus(port = 45123): McpServerStatus {
  return { enabled: true, running: true, port };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('McpSection', () => {
  it('prompts to open a workspace, and never calls the API, when no workspace is open', async () => {
    render(<McpSection onToast={vi.fn()} workspacePath="" />);
    expect(await screen.findByText(/Open a workspace/)).toBeTruthy();
    expect(apiMock.mcpStatus).not.toHaveBeenCalled();
  });

  it('loads and displays status on mount: disabled/not running', async () => {
    apiMock.mcpStatus.mockResolvedValue(disabledStatus());
    render(<McpSection onToast={vi.fn()} workspacePath={WORKSPACE_PATH} />);

    await waitFor(() => expect(apiMock.mcpStatus).toHaveBeenCalledWith(WORKSPACE_PATH));
    expect(await screen.findByText('Not running')).toBeTruthy();
    const toggle = screen.getByTestId('mcp-enabled-toggle').querySelector('input')!;
    expect(toggle.checked).toBe(false);
  });

  it('displays the running URL when the server is running', async () => {
    apiMock.mcpStatus.mockResolvedValue(enabledRunningStatus(45999));
    render(<McpSection onToast={vi.fn()} workspacePath={WORKSPACE_PATH} />);
    expect(await screen.findByText('Running at http://127.0.0.1:45999/mcp')).toBeTruthy();
  });

  it('toggling Enabled calls mcpSetEnabled and reflects the returned status', async () => {
    apiMock.mcpStatus.mockResolvedValue(disabledStatus());
    apiMock.mcpSetEnabled.mockResolvedValue(enabledRunningStatus());
    const onToast = vi.fn();
    const user = userEvent.setup();
    render(<McpSection onToast={onToast} workspacePath={WORKSPACE_PATH} />);

    await screen.findByText('Not running');
    await user.click(screen.getByTestId('mcp-enabled-toggle').querySelector('input')!);

    expect(apiMock.mcpSetEnabled).toHaveBeenCalledWith(WORKSPACE_PATH, true);
    await waitFor(() => expect(screen.getByText(/Running at/)).toBeTruthy());
    expect(onToast).toHaveBeenCalledWith('MCP server enabled', 'success');
  });

  it('the port Save button is disabled until the input actually differs from the current port', async () => {
    apiMock.mcpStatus.mockResolvedValue(disabledStatus(45123));
    const user = userEvent.setup();
    render(<McpSection onToast={vi.fn()} workspacePath={WORKSPACE_PATH} />);

    const saveButton = await screen.findByTestId('mcp-port-save');
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);

    const portInput = screen.getByTestId('mcp-port-input');
    await user.clear(portInput);
    await user.type(portInput, '9999');
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('saving a new port calls mcpSetPort with the numeric value', async () => {
    apiMock.mcpStatus.mockResolvedValue(disabledStatus(45123));
    apiMock.mcpSetPort.mockResolvedValue(disabledStatus(9999));
    const user = userEvent.setup();
    render(<McpSection onToast={vi.fn()} workspacePath={WORKSPACE_PATH} />);

    const portInput = await screen.findByTestId('mcp-port-input');
    await user.clear(portInput);
    await user.type(portInput, '9999');
    await user.click(screen.getByTestId('mcp-port-save'));

    expect(apiMock.mcpSetPort).toHaveBeenCalledWith(WORKSPACE_PATH, 9999);
  });

  it('"Reset to default" calls mcpSetPort with null', async () => {
    apiMock.mcpStatus.mockResolvedValue(disabledStatus(45123));
    apiMock.mcpSetPort.mockResolvedValue(disabledStatus(45123));
    const user = userEvent.setup();
    render(<McpSection onToast={vi.fn()} workspacePath={WORKSPACE_PATH} />);

    await screen.findByTestId('mcp-port-input');
    await user.click(screen.getByText('Reset to default'));

    expect(apiMock.mcpSetPort).toHaveBeenCalledWith(WORKSPACE_PATH, null);
  });

  it('clicking a client button writes its config and toasts the resulting path', async () => {
    apiMock.mcpStatus.mockResolvedValue(enabledRunningStatus());
    apiMock.mcpWriteClientConfig.mockResolvedValue({ configPath: '/tmp/some-workspace/.mcp.json' });
    const onToast = vi.fn();
    const user = userEvent.setup();
    render(<McpSection onToast={onToast} workspacePath={WORKSPACE_PATH} />);

    const claudeButton = await screen.findByTestId('mcp-write-config-claude');
    await user.click(claudeButton);

    expect(apiMock.mcpWriteClientConfig).toHaveBeenCalledWith(WORKSPACE_PATH, 'claude');
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Wrote MCP config to /tmp/some-workspace/.mcp.json', 'success'));
  });

  it('"Copy manual config" fetches the snippet and writes it to the clipboard', async () => {
    apiMock.mcpStatus.mockResolvedValue(enabledRunningStatus());
    apiMock.mcpGetManualSnippet.mockResolvedValue('{"mcpServers":{}}');
    // userEvent.setup() installs its own navigator.clipboard shim, so the
    // spy must be (re-)installed after that call, not before, or this
    // assertion ends up checking user-event's clipboard object instead of ours.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<McpSection onToast={vi.fn()} workspacePath={WORKSPACE_PATH} />);

    const copyButton = await screen.findByTestId('mcp-copy-manual-config');
    await user.click(copyButton);

    expect(apiMock.mcpGetManualSnippet).toHaveBeenCalledWith(WORKSPACE_PATH);
    expect(writeText).toHaveBeenCalledWith('{"mcpServers":{}}');
  });

  it('does not show the "Connect an agent" section while disabled', async () => {
    apiMock.mcpStatus.mockResolvedValue(disabledStatus());
    render(<McpSection onToast={vi.fn()} workspacePath={WORKSPACE_PATH} />);
    await screen.findByText('Not running');
    expect(screen.queryByTestId('mcp-write-config-claude')).toBeNull();
  });
});
