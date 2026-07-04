import { describe, it, expect, beforeEach } from 'vitest';
import {
  useEditorStore,
  resetEditorStore,
  tabKey,
  openOrFocusTab,
  setTabLoaded,
  setTabError,
  setTabContent,
  setTabSaved,
  handleExternalChange,
  resolveConflictReload,
  resolveConflictKeepMine,
  closeTab,
  setActiveTab,
} from '../editor-store.js';

const WORKTREE = '/ws/.sproutgit/worktrees/main';

function tabFor(key: string) {
  const tab = useEditorStore.getState().tabs[key];
  if (!tab) throw new Error(`No tab found for key: ${key}`);
  return tab;
}

describe('editor-store', () => {
  beforeEach(() => {
    resetEditorStore();
  });

  describe('openOrFocusTab', () => {
    it('opens a new tab in a loading state and makes it active', () => {
      const key = openOrFocusTab(WORKTREE, 'src/a.ts');

      expect(key).toBe(tabKey(WORKTREE, 'src/a.ts'));
      const state = useEditorStore.getState();
      expect(state.activeTabKey).toBe(key);
      expect(state.tabOrder).toEqual([key]);
      expect(tabFor(key)).toMatchObject({
        relativePath: 'src/a.ts',
        worktreePath: WORKTREE,
        content: '',
        savedContent: '',
        dirty: false,
        loading: true,
        conflict: false,
        error: null,
      });
    });

    it('re-focuses an already-open tab instead of duplicating it', () => {
      const key1 = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key1, 'hello', 100);
      openOrFocusTab(WORKTREE, 'b.ts'); // switch active tab away from a.ts

      const key2 = openOrFocusTab(WORKTREE, 'a.ts');

      expect(key2).toBe(key1);
      const state = useEditorStore.getState();
      expect(state.tabOrder).toEqual([key1, tabKey(WORKTREE, 'b.ts')]); // no duplicate entry
      expect(state.activeTabKey).toBe(key1); // refocused
      expect(tabFor(key1).content).toBe('hello'); // untouched, not reset to loading
    });

    it('keys tabs by worktreePath + relativePath, so the same relative path in two worktrees is a separate tab', () => {
      const keyA = openOrFocusTab('/ws/wt-a', 'file.txt');
      const keyB = openOrFocusTab('/ws/wt-b', 'file.txt');

      expect(keyA).not.toBe(keyB);
      expect(useEditorStore.getState().tabOrder).toHaveLength(2);
    });
  });

  describe('setTabLoaded / setTabError', () => {
    it('marks a tab loaded with content becoming both content and savedContent, clean and not loading', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key, 'const x = 1;', 12345);

      expect(tabFor(key)).toMatchObject({
        content: 'const x = 1;',
        savedContent: 'const x = 1;',
        knownMtimeMs: 12345,
        loading: false,
        dirty: false,
        error: null,
      });
    });

    it('setTabError records the error and clears the loading flag', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabError(key, 'ENOENT: no such file');

      expect(tabFor(key)).toMatchObject({ loading: false, error: 'ENOENT: no such file' });
    });

    it('is a no-op for an unknown tab key', () => {
      expect(() => setTabLoaded('nonexistent', 'x', 1)).not.toThrow();
      expect(useEditorStore.getState().tabs['nonexistent']).toBeUndefined();
    });
  });

  describe('setTabContent (dirty tracking)', () => {
    it('marks the tab dirty when content diverges from savedContent', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key, 'original', 1);

      setTabContent(key, 'original + edits');

      expect(tabFor(key)).toMatchObject({ content: 'original + edits', dirty: true });
    });

    it('is clean again if content is edited back to match savedContent', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key, 'original', 1);

      setTabContent(key, 'changed');
      expect(tabFor(key).dirty).toBe(true);

      setTabContent(key, 'original');
      expect(tabFor(key).dirty).toBe(false);
    });
  });

  describe('setTabSaved', () => {
    it('updates content/savedContent/knownMtimeMs and clears dirty and conflict', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key, 'original', 1);
      setTabContent(key, 'edited');

      setTabSaved(key, 'edited', 999);

      expect(tabFor(key)).toMatchObject({
        content: 'edited',
        savedContent: 'edited',
        knownMtimeMs: 999,
        dirty: false,
        conflict: false,
      });
    });
  });

  describe('handleExternalChange — the clean-tab vs dirty-tab conflict state machine', () => {
    it('auto-reloads a clean tab silently (no conflict) when disk changes externally', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key, 'v1', 100);

      handleExternalChange(key, 'v2 from disk', 200);

      expect(tabFor(key)).toMatchObject({
        content: 'v2 from disk',
        savedContent: 'v2 from disk',
        knownMtimeMs: 200,
        conflict: false,
        dirty: false,
      });
    });

    it('flags a conflict on a dirty tab instead of touching its buffer', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key, 'v1', 100);
      setTabContent(key, 'my local edits'); // dirty=true

      handleExternalChange(key, 'v2 from disk', 200);

      const tab = tabFor(key);
      expect(tab.conflict).toBe(true);
      expect(tab.content).toBe('my local edits'); // untouched
      expect(tab.dirty).toBe(true); // still dirty
      expect(tab.knownMtimeMs).toBe(200); // mtime is updated so a later reload compares against the latest disk version
      expect(tab.savedContent).toBe('v1'); // savedContent unchanged — still reflects the last known-synced version
    });

    it('is a no-op for an unknown tab key', () => {
      expect(() => handleExternalChange('nonexistent', 'x', 1)).not.toThrow();
    });
  });

  describe('resolveConflictReload — user picks "Reload"', () => {
    it('discards local edits and adopts disk content, clearing dirty and conflict', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key, 'v1', 100);
      setTabContent(key, 'my local edits');
      handleExternalChange(key, 'v2 from disk', 200);
      expect(tabFor(key).conflict).toBe(true);

      resolveConflictReload(key, 'v2 from disk', 200);

      expect(tabFor(key)).toMatchObject({
        content: 'v2 from disk',
        savedContent: 'v2 from disk',
        knownMtimeMs: 200,
        dirty: false,
        conflict: false,
      });
    });
  });

  describe('resolveConflictKeepMine — user picks "Keep mine"', () => {
    it('dismisses the conflict banner but keeps the local buffer and dirty flag intact', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key, 'v1', 100);
      setTabContent(key, 'my local edits');
      handleExternalChange(key, 'v2 from disk', 200);
      expect(tabFor(key).conflict).toBe(true);

      resolveConflictKeepMine(key);

      const tab = tabFor(key);
      expect(tab.conflict).toBe(false);
      expect(tab.content).toBe('my local edits'); // preserved
      expect(tab.dirty).toBe(true); // still considered dirty relative to savedContent ('v1')
    });

    it('a subsequent save can still complete normally after "Keep mine"', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      setTabLoaded(key, 'v1', 100);
      setTabContent(key, 'my local edits');
      handleExternalChange(key, 'v2 from disk', 200);
      resolveConflictKeepMine(key);

      setTabSaved(key, 'my local edits', 300);

      expect(tabFor(key)).toMatchObject({
        content: 'my local edits',
        savedContent: 'my local edits',
        knownMtimeMs: 300,
        dirty: false,
        conflict: false,
      });
    });
  });

  describe('closeTab', () => {
    it('removes the tab and its entry from tabOrder', () => {
      const key = openOrFocusTab(WORKTREE, 'a.ts');
      closeTab(key);

      const state = useEditorStore.getState();
      expect(state.tabs[key]).toBeUndefined();
      expect(state.tabOrder).toEqual([]);
    });

    it('falls back the active tab to the previous tab in order when closing the active tab', () => {
      const key1 = openOrFocusTab(WORKTREE, 'a.ts');
      const key2 = openOrFocusTab(WORKTREE, 'b.ts');
      const key3 = openOrFocusTab(WORKTREE, 'c.ts');
      expect(useEditorStore.getState().activeTabKey).toBe(key3);

      closeTab(key3);

      expect(useEditorStore.getState().activeTabKey).toBe(key2);
      expect(useEditorStore.getState().tabOrder).toEqual([key1, key2]);
    });

    it('leaves activeTabKey null when closing the last remaining tab', () => {
      const key = openOrFocusTab(WORKTREE, 'only.ts');
      closeTab(key);
      expect(useEditorStore.getState().activeTabKey).toBeNull();
    });

    it('does not change activeTabKey when closing a tab that is not the active one', () => {
      const key1 = openOrFocusTab(WORKTREE, 'a.ts');
      const key2 = openOrFocusTab(WORKTREE, 'b.ts');
      expect(useEditorStore.getState().activeTabKey).toBe(key2);

      closeTab(key1);

      expect(useEditorStore.getState().activeTabKey).toBe(key2);
      expect(useEditorStore.getState().tabOrder).toEqual([key2]);
    });
  });

  describe('setActiveTab', () => {
    it('sets the active tab key directly', () => {
      const key1 = openOrFocusTab(WORKTREE, 'a.ts');
      openOrFocusTab(WORKTREE, 'b.ts');

      setActiveTab(key1);

      expect(useEditorStore.getState().activeTabKey).toBe(key1);
    });
  });

  describe('resetEditorStore', () => {
    it('clears all tabs, order, and active tab', () => {
      openOrFocusTab(WORKTREE, 'a.ts');
      openOrFocusTab(WORKTREE, 'b.ts');

      resetEditorStore();

      const state = useEditorStore.getState();
      expect(state.tabs).toEqual({});
      expect(state.tabOrder).toEqual([]);
      expect(state.activeTabKey).toBeNull();
    });
  });
});
