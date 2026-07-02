import { Spinner, linkifyIssueRefs } from '@sproutgit/ui';
import type { CommitEntry, DiffFileEntry, IssueTrackerPattern } from '@sproutgit/types';
import { X } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import typescriptLang from 'highlight.js/lib/languages/typescript';
import javascriptLang from 'highlight.js/lib/languages/javascript';
import rustLang from 'highlight.js/lib/languages/rust';
import cssLang from 'highlight.js/lib/languages/css';
import jsonLang from 'highlight.js/lib/languages/json';
import xmlLang from 'highlight.js/lib/languages/xml';
import bashLang from 'highlight.js/lib/languages/bash';
import markdownLang from 'highlight.js/lib/languages/markdown';
import yamlLang from 'highlight.js/lib/languages/yaml';
import sqlLang from 'highlight.js/lib/languages/sql';
import pythonLang from 'highlight.js/lib/languages/python';
import goLang from 'highlight.js/lib/languages/go';

hljs.registerLanguage('typescript', typescriptLang);
hljs.registerLanguage('javascript', javascriptLang);
hljs.registerLanguage('rust', rustLang);
hljs.registerLanguage('css', cssLang);
hljs.registerLanguage('json', jsonLang);
hljs.registerLanguage('xml', xmlLang);
hljs.registerLanguage('bash', bashLang);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('yaml', yamlLang);
hljs.registerLanguage('sql', sqlLang);
hljs.registerLanguage('python', pythonLang);
hljs.registerLanguage('go', goLang);

type Props = {
  commit: CommitEntry;
  files: DiffFileEntry[];
  loading: boolean;
  selectedFile: DiffFileEntry | null;
  diffContent: string;
  diffLoading: boolean;
  onSelectFile: (f: DiffFileEntry) => void;
  onClose: () => void;
  issueTrackerPatterns?: IssueTrackerPattern[];
};

const iconBtn = 'inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised)';

function renderDiffHtml(raw: string, filePath: string | null): string {
  if (!raw.trim()) return '<span class="sg-diff-empty">No changes</span>';
  const lang = languageForPath(filePath);
  return raw.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) return `<div class="sg-diff-add">+${highlightCode(line.slice(1), lang)}</div>`;
    if (line.startsWith('-') && !line.startsWith('---')) return `<div class="sg-diff-del">-${highlightCode(line.slice(1), lang)}</div>`;
    if (line.startsWith('@@')) return `<div class="sg-diff-hunk">${escapeHtml(line)}</div>`;
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      return `<div class="sg-diff-meta">${escapeHtml(line)}</div>`;
    }
    if (line.startsWith(' ')) {
      return `<div class="sg-diff-ctx"> ${highlightCode(line.slice(1), lang)}</div>`;
    }
    return `<div class="sg-diff-ctx">${highlightCode(line, lang)}</div>`;
  }).join('');
}

const extToLang: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  rs: 'rust',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  html: 'xml',
  svg: 'xml',
  sh: 'bash',
  zsh: 'bash',
  bash: 'bash',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  py: 'python',
  go: 'go',
};

function languageForPath(path: string | null): string | null {
  if (!path) return null;
  const ext = path.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return extToLang[ext] ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCode(code: string, language: string | null): string {
  if (!language || !code) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

export function CommitDiffPanel({ commit, files, loading, selectedFile, diffContent, diffLoading, onSelectFile, onClose, issueTrackerPatterns = [] }: Props) {
  return (
    <div className="border-t border-(--sg-border) flex flex-col max-h-[320px] shrink-0 bg-(--sg-surface)">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-(--sg-border-subtle) min-h-8 shrink-0">
        <span className="font-(family-name:--sg-font-code) text-[11px] text-(--sg-primary) shrink-0">{commit.shortHash}</span>
        <span
          className="text-xs font-medium text-(--sg-text) overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0"
          onClick={e => {
            if (e.target instanceof HTMLAnchorElement) {
              e.preventDefault();
              void window.api.openUrl(e.target.href);
            }
          }}
          dangerouslySetInnerHTML={{ __html: linkifyIssueRefs(commit.subject, issueTrackerPatterns) }}
        />
        <span className="text-[11px] text-(--sg-text-dim) shrink-0">{commit.authorName}</span>
        <button className={iconBtn} style={{ marginLeft: 'auto' }} onClick={onClose} title="Close diff">
          <X size={13} />
        </button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {loading ? (
          <div className="p-4"><Spinner /></div>
        ) : (
          <>
            <div className="w-[220px] shrink-0 overflow-y-auto border-r border-(--sg-border-subtle) flex flex-col">
              {files.map(f => (
                <button
                  key={f.path}
                  data-testid="commit-diff-file-row"
                  data-path={f.path}
                  className={`flex items-center gap-1.5 px-[10px] py-1 bg-transparent border-none cursor-pointer text-left text-[11px] min-w-0 transition-colors ${selectedFile?.path === f.path ? 'bg-(--sg-surface-raised) text-(--sg-text)' : 'text-(--sg-text-dim) hover:bg-(--sg-surface-raised) hover:text-(--sg-text)'}`}
                  onClick={() => onSelectFile(f)}
                  title={f.path}
                >
                  <span className="font-(family-name:--sg-font-code) text-[11px] shrink-0 w-[14px]" data-status={f.status}>{f.status}</span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{f.path}</span>
                </button>
              ))}
              {files.length === 0 && (
                <span className="px-3 py-2 text-xs text-(--sg-text-dim)">No file changes</span>
              )}
            </div>
            {selectedFile && (
              <div className="flex-1 overflow-auto">
                {diffLoading ? (
                  <div className="p-4"><Spinner /></div>
                ) : (
                  <pre className="sg-diff" dangerouslySetInnerHTML={{ __html: renderDiffHtml(diffContent, selectedFile.path) }} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
