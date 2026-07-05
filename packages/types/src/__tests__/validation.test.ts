import { describe, it, expect } from 'vitest';
import { validateBranchName } from '../validation.js';

describe('validateBranchName', () => {
  it('accepts a normal branch name', () => {
    expect(validateBranchName('feature/my-branch')).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(validateBranchName('   ')).toBe('Branch name is required.');
  });

  it('rejects a name starting with a hyphen', () => {
    expect(validateBranchName('-foo')).toBe('Cannot start with a hyphen.');
  });

  it('rejects a name starting with a slash', () => {
    expect(validateBranchName('/etc/passwd')).toBe('Cannot start with a slash.');
  });

  it('rejects a name that is only a slash', () => {
    expect(validateBranchName('/')).toBe('Cannot start with a slash.');
  });

  it('rejects a name starting with a dot', () => {
    expect(validateBranchName('.foo')).toBe("Cannot start with a dot or contain '/.'.");
  });

  it('rejects a name containing /.', () => {
    expect(validateBranchName('foo/.bar')).toBe("Cannot start with a dot or contain '/.'.");
  });

  it('rejects a name ending with a dot', () => {
    expect(validateBranchName('foo.')).toBe('Cannot end with a dot.');
  });

  it('rejects a name ending with a slash', () => {
    expect(validateBranchName('foo/')).toBe('Cannot end with a slash.');
  });

  it("rejects a name containing '..'", () => {
    expect(validateBranchName('foo..bar')).toBe("Cannot contain '..'.");
  });

  it("rejects a name containing '@{'", () => {
    expect(validateBranchName('foo@{bar')).toBe("Cannot contain '@{'.");
  });

  it("rejects a name that is just '@'", () => {
    expect(validateBranchName('@')).toBe("Cannot be '@'.");
  });

  it("rejects a name ending with '.lock'", () => {
    expect(validateBranchName('foo.lock')).toBe("Cannot end with '.lock'.");
  });

  it('rejects a name containing a backslash', () => {
    expect(validateBranchName('foo\\bar')).toBe('Cannot contain backslash.');
  });

  it('rejects a name containing spaces or special chars', () => {
    expect(validateBranchName('foo bar')).toBe('Cannot contain spaces or special chars.');
    expect(validateBranchName('foo~bar')).toBe('Cannot contain spaces or special chars.');
    expect(validateBranchName('foo^bar')).toBe('Cannot contain spaces or special chars.');
    expect(validateBranchName('foo:bar')).toBe('Cannot contain spaces or special chars.');
  });

  it('rejects a name containing glob characters', () => {
    expect(validateBranchName('foo*bar')).toBe('Cannot contain glob chars.');
    expect(validateBranchName('foo?bar')).toBe('Cannot contain glob chars.');
    expect(validateBranchName('foo[bar]')).toBe('Cannot contain glob chars.');
  });

  it('rejects a name containing consecutive slashes', () => {
    expect(validateBranchName('foo//bar')).toBe('Cannot contain consecutive slashes.');
  });
});
