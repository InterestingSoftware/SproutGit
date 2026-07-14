import { create } from 'zustand';
import type { WorktreeInfo } from '@sproutgit/types';

export type Tab = 'graph' | 'staging' | 'terminal' | 'chat' | 'files' | 'conflicts';
export type TerminalLayout = 'tabs' | 'split' | 'grid';
type TerminalSession = {
  id: string;
  label: string;
  pendingData: string;
  /** Characters permanently dropped from the front of `pendingData` because
   *  the live buffer exceeded its cap — lets consumers reading `pendingData`
   *  as an ever-growing stream compute correct deltas despite the trim. */
  droppedLen: number;
  cwd: string;
  agentId: string | null;
};

interface WorkspaceUiState {
  workspacePath: string;
  /** Active worktree selected in the sidebar. */
  activeWorktree: WorktreeInfo | null;
  // Tab bar
  activeTab: Tab;
  // Remote op loading flags
  fetching: boolean;
  pulling: boolean;
  pushing: boolean;
  // Shell preference (loaded from settings)
  defaultShell: string;
  // Terminals
  terminalSessions: TerminalSession[];
  activeTerminalId: string | null;
  terminalLayout: TerminalLayout;
  /** Saves the last-active terminal ID per worktree path for save/restore on switch. */
  worktreeActiveTerminalId: Record<string, string | null>;
  // Pending worktree creation
  pendingCreationBranch: string | null;
  creatingWorktree: boolean;
}

function readInitialTab(): Tab {
  const s = sessionStorage.getItem('sg_active_tab');
  return s === 'staging' || s === 'terminal' || s === 'chat' || s === 'files' || s === 'conflicts' ? s : 'graph';
}

function readInitialTerminalLayout(): TerminalLayout {
  const s = sessionStorage.getItem('sg_terminal_layout');
  return s === 'split' || s === 'grid' ? s : 'tabs';
}

const baseUiState: Omit<WorkspaceUiState, 'workspacePath'> = {
  activeWorktree: null,
  activeTab: readInitialTab(),
  fetching: false,
  pulling: false,
  pushing: false,
  defaultShell: '',
  terminalSessions: [],
  activeTerminalId: null,
  terminalLayout: readInitialTerminalLayout(),
  worktreeActiveTerminalId: {},
  pendingCreationBranch: null,
  creatingWorktree: false,
};

export const useWorkspaceStore = create<WorkspaceUiState>()(() => ({
  workspacePath: '',
  ...baseUiState,
}));

/** Reset UI state when switching to a new workspace.
 *  When returning to the same workspace (e.g. navigating back from the Projects screen)
 *  terminal sessions are preserved so PTY sessions survive navigation. */
export function resetWorkspaceStore(workspacePath: string) {
  const current = useWorkspaceStore.getState();
  if (current.workspacePath === workspacePath) {
    // Same workspace — reset only non-terminal UI state so live sessions survive.
    useWorkspaceStore.setState({
      activeWorktree: null,
      activeTab: readInitialTab(),
      fetching: false,
      pulling: false,
      pushing: false,
      defaultShell: '',
      pendingCreationBranch: null,
      creatingWorktree: false,
    });
  } else {
    // Different workspace — full reset (including terminal sessions).
    useWorkspaceStore.setState({ workspacePath, ...baseUiState, activeTab: readInitialTab() });
  }
}
