import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DiffViewer } from '../components/DiffViewer.js';

afterEach(() => { cleanup(); });

describe('DiffViewer', () => {
  it('renders --- / +++ file header lines with meta styling, not context styling', () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234567..89abcde 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,2 +1,2 @@',
      '-old line',
      '+new line',
      ' unchanged line',
    ].join('\n');

    const { container } = render(<DiffViewer content={diff} />);
    const lines = Array.from(container.querySelectorAll('.sg-diff > div'));
    const byText = (text: string) => lines.find(l => l.textContent === text);

    expect(byText('--- a/foo.ts')?.className).toBe('sg-diff-meta');
    expect(byText('+++ b/foo.ts')?.className).toBe('sg-diff-meta');
    expect(byText(' unchanged line')?.className).toBe('sg-diff-ctx');
  });

  it('does not misclassify add/del content lines that start with ++ or --', () => {
    // An added line whose content is "++foo" becomes "+++foo" in the diff;
    // a removed line whose content is "--bar" becomes "---bar". Neither has
    // the space that real "--- a/path" / "+++ b/path" headers always have.
    const diff = ['@@ -1,2 +1,2 @@', '+++foo', '---bar'].join('\n');

    const { container } = render(<DiffViewer content={diff} />);
    const lines = Array.from(container.querySelectorAll('.sg-diff > div'));
    const byText = (text: string) => lines.find(l => l.textContent === text);

    expect(byText('+++foo')?.className).toBe('sg-diff-add');
    expect(byText('---bar')?.className).toBe('sg-diff-del');
  });
});
