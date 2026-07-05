import { Spinner } from './Spinner.js';

type Props = {
  /** Raw unified diff text */
  content: string;
  loading?: boolean;
  /** File path to display in the header */
  filePath?: string;
};

// Unified diff file headers are always "--- a/path" / "+++ b/path" (or /dev/null),
// i.e. the marker followed by a space — unlike an added/removed line whose content
// happens to start with "++"/"--", which has no space right after the marker.
const OLD_FILE_HEADER = /^--- /;
const NEW_FILE_HEADER = /^\+\+\+ /;

/** Parse unified diff lines into annotated tokens for highlighting. */
function parseDiffLines(raw: string): { kind: 'add' | 'del' | 'ctx' | 'meta'; text: string }[] {
  return raw.split('\n').map(line => {
    if (line.startsWith('+') && !NEW_FILE_HEADER.test(line))
      return { kind: 'add' as const, text: line };
    if (line.startsWith('-') && !OLD_FILE_HEADER.test(line))
      return { kind: 'del' as const, text: line };
    if (
      line.startsWith('@@') ||
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      OLD_FILE_HEADER.test(line) ||
      NEW_FILE_HEADER.test(line)
    )
      return { kind: 'meta' as const, text: line };
    return { kind: 'ctx' as const, text: line };
  });
}

const kindCls: Record<'add' | 'del' | 'ctx' | 'meta', string> = {
  add: 'sg-diff-add',
  del: 'sg-diff-del',
  ctx: 'sg-diff-ctx',
  meta: 'sg-diff-meta',
};

export function DiffViewer({ content, loading = false, filePath }: Props) {
  const lines = parseDiffLines(content);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner />
      </div>
    );
  }

  if (!content.trim()) {
    return (
      <div className="flex items-center justify-center p-4 text-(--sg-text-faint) text-xs">
        No changes
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {filePath && (
        <div className="flex items-center px-3 py-1.5 border-b border-(--sg-border-subtle) bg-(--sg-surface-raised) sticky top-0">
          <span className="font-(family-name:--sg-font-code) text-[11px] text-(--sg-text-dim)">{filePath}</span>
        </div>
      )}
      <pre className="sg-diff" dangerouslySetInnerHTML={{ __html: lines.map(l => `<div class="${kindCls[l.kind]}">${escDiff(l.text)}</div>`).join('') }} />
    </div>
  );
}

function escDiff(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
