import { useEditorStore, tabKey } from "../stores/editor-store.js";

/** Derives the open editor tabs (and active tab) scoped to one worktree. */
export function useEditorTabsForWorktree(worktreePath: string | undefined) {
  const editorTabs = useEditorStore((s) => s.tabs);
  const editorTabOrder = useEditorStore((s) => s.tabOrder);
  const editorActiveTabKeyRaw = useEditorStore((s) => s.activeTabKey);

  const editorTabsForActiveWorktree = editorTabOrder
    .map((k) => editorTabs[k])
    .filter(
      (t): t is NonNullable<typeof t> => !!t && t.worktreePath === worktreePath,
    );
  const editorActiveTabKey = editorTabsForActiveWorktree.some(
    (t) => tabKey(t.worktreePath, t.relativePath) === editorActiveTabKeyRaw,
  )
    ? editorActiveTabKeyRaw
    : null;
  const activeEditorTab =
    editorTabsForActiveWorktree.find(
      (t) => tabKey(t.worktreePath, t.relativePath) === editorActiveTabKey,
    ) ?? null;

  return { editorTabsForActiveWorktree, editorActiveTabKey, activeEditorTab };
}
