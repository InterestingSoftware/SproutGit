import { describe, it, expect } from 'vitest';
import { linkifyIssueRefs, matchIssueRef } from '../issuetracker-linkify.js';
import type { IssueTrackerPattern } from '@sproutgit/types';

const jiraPattern: IssueTrackerPattern = {
  label: 'Jira',
  regex: 'ABCD-(\\d+)',
  url: 'https://my-company.atlassian.net/browse/ABCD-$1',
};

describe('linkifyIssueRefs', () => {
  it('links a matching reference', () => {
    const html = linkifyIssueRefs('Fix ABCD-123 crash', [jiraPattern]);
    expect(html).toBe('Fix <a href="https://my-company.atlassian.net/browse/ABCD-123">ABCD-123</a> crash');
  });

  it('escapes text with no match', () => {
    const html = linkifyIssueRefs('Fix <script> crash', [jiraPattern]);
    expect(html).toBe('Fix &lt;script&gt; crash');
  });

  it('escapes text with no patterns configured', () => {
    const html = linkifyIssueRefs('Fix ABCD-123', []);
    expect(html).toBe('Fix ABCD-123');
  });

  it('links multiple patterns in the same string', () => {
    const githubPattern: IssueTrackerPattern = {
      label: 'GitHub',
      regex: '#(\\d+)',
      url: 'https://github.com/org/repo/issues/$1',
    };
    const html = linkifyIssueRefs('ABCD-123 relates to #45', [jiraPattern, githubPattern]);
    expect(html).toBe(
      '<a href="https://my-company.atlassian.net/browse/ABCD-123">ABCD-123</a> relates to <a href="https://github.com/org/repo/issues/45">#45</a>',
    );
  });

  it('skips a pattern with an invalid regex rather than throwing', () => {
    const badPattern: IssueTrackerPattern = { label: 'Bad', regex: '(unclosed', url: 'https://example.com/$1' };
    const html = linkifyIssueRefs('Fix ABCD-123', [badPattern, jiraPattern]);
    expect(html).toBe('Fix <a href="https://my-company.atlassian.net/browse/ABCD-123">ABCD-123</a>');
  });

  it('leaves a match as plain text when the resolved URL is not http(s)', () => {
    const fileUrlPattern: IssueTrackerPattern = { label: 'Local', regex: 'LOCAL-(\\d+)', url: 'file:///issues/$1' };
    const html = linkifyIssueRefs('Fix LOCAL-42', [fileUrlPattern]);
    expect(html).toBe('Fix LOCAL-42');
  });

  it('leaves a match as plain text when the resolved URL is malformed', () => {
    const malformedPattern: IssueTrackerPattern = { label: 'Bad', regex: 'BAD-(\\d+)', url: 'not a url $1' };
    const html = linkifyIssueRefs('Fix BAD-42', [malformedPattern]);
    expect(html).toBe('Fix BAD-42');
  });
});

describe('matchIssueRef', () => {
  it('resolves a matching reference', () => {
    expect(matchIssueRef('ABCD-123', [jiraPattern])).toEqual({
      label: 'Jira',
      ref: 'ABCD-123',
      url: 'https://my-company.atlassian.net/browse/ABCD-123',
    });
  });

  it('matches embedded within a pasted URL', () => {
    const result = matchIssueRef('https://my-company.atlassian.net/browse/ABCD-123', [jiraPattern]);
    expect(result?.ref).toBe('ABCD-123');
  });

  it('returns null for empty input', () => {
    expect(matchIssueRef('  ', [jiraPattern])).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchIssueRef('no issue ref here', [jiraPattern])).toBeNull();
  });
});
