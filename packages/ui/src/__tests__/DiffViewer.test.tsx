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
});
