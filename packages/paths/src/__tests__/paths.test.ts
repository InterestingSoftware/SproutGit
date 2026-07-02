import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalize, isPathWithin } from '../index.js';

describe('isPathWithin', () => {
  it('is true when the child path equals the parent path', () => {
    expect(isPathWithin('/a/b/c', '/a/b/c')).toBe(true);
  });

  it('is true when the child path is nested inside the parent path', () => {
    expect(isPathWithin('/a/b/c/d', '/a/b/c')).toBe(true);
  });

  it('is false for a sibling directory with a shared prefix (no separator boundary)', () => {
    expect(isPathWithin('/a/b/worktrees-other', '/a/b/worktrees')).toBe(false);
  });

  it('is false when the child is outside the parent entirely', () => {
    expect(isPathWithin('/x/y', '/a/b')).toBe(false);
  });

  it('resolves relative segments before comparing', () => {
    expect(isPathWithin('/a/b/../b/c', '/a/b')).toBe(true);
  });
});

describe('canonicalize', () => {
  it('resolves symlinks so both sides of a comparison agree', () => {
    const base = mkdtempSync(join(tmpdir(), 'sg-paths-real-'));
    const real = join(base, 'real');
    const link = join(base, 'link');
    mkdirSync(real);
    symlinkSync(real, link, 'dir');

    expect(canonicalize(link)).toBe(canonicalize(real));

    rmSync(base, { recursive: true, force: true });
  });

  it('falls back to a plain resolve() for a path that does not exist', () => {
    const missing = join(tmpdir(), 'sg-paths-does-not-exist-xyz');
    expect(canonicalize(missing)).toBe(missing);
  });
});
