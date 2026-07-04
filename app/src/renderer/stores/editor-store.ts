import { create } from 'zustand';

/**
 * State for one open file tab in the file editor.
 *
 * - `savedContent` is the last content known to match disk (from the initial
 *   read, or the most recent successful save / external reload).
 * - `content` is the live editor buffer. `dirty` is derived by comparing the
 *   two whenever `content` changes.
 * - `conflict` is set when the file changes on disk while the tab has unsaved
 *   local changes — the UI shows a banner instead of silently overwriting
 *   either side.
 */
export type FileTab = {
  /** Path relative to the worktree root, using forward slashes. Unique key within a worktree. */
  relativePath: string;
  worktreePath: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  /** mtimeMs of the version currently reflected in `savedContent`. */
  knownMtimeMs: number;
  loading: boolean;
  /** Set when disk changed while `dirty` was true — shows the conflict banner. */
  conflict: boolean;
  error: string | null;
};

interface EditorState {
  /** Keyed by `${worktreePath}::${relativePath}`. */
  tabs: Record<string, FileTab>;
  /** Order of tab keys as shown in the tab strip. */
  tabOrder: string[];
  activeTabKey: string | null;
}

export function tabKey(worktreePath: string, relativePath: string): string {
  return `${worktreePath}::${relativePath}`;
}

const initialState: EditorState = {
  tabs: {},
  tabOrder: [],
  activeTabKey: null,
};

export const useEditorStore = create<EditorState>()(() => ({ ...initialState }));

export function resetEditorStore() {
  useEditorStore.setState({ ...initialState });
}

export function openOrFocusTab(worktreePath: string, relativePath: string) {
  const key = tabKey(worktreePath, relativePath);
  useEditorStore.setState(s => {
    if (s.tabs[key]) {
      return { activeTabKey: key };
    }
    return {
      tabs: {
        ...s.tabs,
        [key]: {
          relativePath,
          worktreePath,
          content: '',
          savedContent: '',
          dirty: false,
          knownMtimeMs: 0,
          loading: true,
          conflict: false,
          error: null,
        },
      },
      tabOrder: [...s.tabOrder, key],
      activeTabKey: key,
    };
  });
  return key;
}

export function setTabLoaded(key: string, content: string, mtimeMs: number) {
  useEditorStore.setState(s => {
    const tab = s.tabs[key];
    if (!tab) return {};
    return {
      tabs: {
        ...s.tabs,
        [key]: { ...tab, content, savedContent: content, knownMtimeMs: mtimeMs, loading: false, dirty: false, error: null },
      },
    };
  });
}

export function setTabError(key: string, error: string) {
  useEditorStore.setState(s => {
    const tab = s.tabs[key];
    if (!tab) return {};
    return { tabs: { ...s.tabs, [key]: { ...tab, loading: false, error } } };
  });
}

export function setTabContent(key: string, content: string) {
  useEditorStore.setState(s => {
    const tab = s.tabs[key];
    if (!tab) return {};
    return {
      tabs: {
        ...s.tabs,
        [key]: { ...tab, content, dirty: content !== tab.savedContent },
      },
    };
  });
}

export function setTabSaved(key: string, content: string, mtimeMs: number) {
  useEditorStore.setState(s => {
    const tab = s.tabs[key];
    if (!tab) return {};
    return {
      tabs: {
        ...s.tabs,
        [key]: { ...tab, content, savedContent: content, knownMtimeMs: mtimeMs, dirty: false, conflict: false },
      },
    };
  });
}

/** Called when the watcher reports an external change to a file with an open tab. */
export function handleExternalChange(key: string, diskContent: string, mtimeMs: number) {
  useEditorStore.setState(s => {
    const tab = s.tabs[key];
    if (!tab) return {};
    if (!tab.dirty) {
      // No local changes — safe to auto-reload silently.
      return {
        tabs: {
          ...s.tabs,
          [key]: { ...tab, content: diskContent, savedContent: diskContent, knownMtimeMs: mtimeMs, conflict: false },
        },
      };
    }
    // Unsaved local changes exist — don't touch the buffer, just flag the conflict.
    return {
      tabs: { ...s.tabs, [key]: { ...tab, conflict: true, knownMtimeMs: mtimeMs } },
    };
  });
}

/** User chose "Reload" in the conflict banner — discard local edits, take disk content. */
export function resolveConflictReload(key: string, diskContent: string, mtimeMs: number) {
  useEditorStore.setState(s => {
    const tab = s.tabs[key];
    if (!tab) return {};
    return {
      tabs: {
        ...s.tabs,
        [key]: { ...tab, content: diskContent, savedContent: diskContent, knownMtimeMs: mtimeMs, dirty: false, conflict: false },
      },
    };
  });
}

/** User chose "Keep mine" — dismiss the banner, keep local buffer as-is (still dirty). */
export function resolveConflictKeepMine(key: string) {
  useEditorStore.setState(s => {
    const tab = s.tabs[key];
    if (!tab) return {};
    return { tabs: { ...s.tabs, [key]: { ...tab, conflict: false } } };
  });
}

export function closeTab(key: string) {
  useEditorStore.setState(s => {
    const { [key]: _removed, ...rest } = s.tabs;
    const order = s.tabOrder.filter(k => k !== key);
    const activeTabKey = s.activeTabKey === key ? (order.at(-1) ?? null) : s.activeTabKey;
    return { tabs: rest, tabOrder: order, activeTabKey };
  });
}

export function setActiveTab(key: string) {
  useEditorStore.setState({ activeTabKey: key });
}
