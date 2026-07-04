import { useEffect, useRef, useState } from 'react';
import { loader } from '@monaco-editor/react';
import * as monacoApi from 'monaco-editor';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

loader.config({ monaco: monacoApi });

// `MonacoEnvironment` isn't part of the standard `Window & typeof globalThis`
// typing, so `self.MonacoEnvironment` needs an explicit typed cast rather than
// an untyped property access.
type MonacoEnvironmentShape = { getWorker: (workerId: string, label: string) => Worker };
type GlobalWithMonacoEnvironment = typeof globalThis & { MonacoEnvironment?: MonacoEnvironmentShape };

// Without this, Monaco falls back to running language services on the main
// thread (console warning: "You must define a function
// MonacoEnvironment.getWorkerUrl or MonacoEnvironment.getWorker"), which can
// jank the UI on large files. Vite's `?worker` import produces a proper
// Worker constructor for each of Monaco's bundled language workers.
const globalSelf = typeof self !== 'undefined' ? (self as GlobalWithMonacoEnvironment) : undefined;
if (globalSelf && !globalSelf.MonacoEnvironment) {
  globalSelf.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    },
  };
}

type Props = {
  value: string;
  language?: string;
  theme?: 'auto' | 'light' | 'dark';
  height?: string;
  readOnly?: boolean;
  onChange?: (next: string) => void;
};

function resolveLanguage(language: string | undefined) {
  if (!language) return 'plaintext';
  const normalized = language.toLowerCase();
  if (normalized === 'shell' || normalized === 'bash' || normalized === 'zsh' || normalized === 'sh') {
    return 'shell';
  }
  if (normalized === 'powershell' || normalized === 'pwsh') {
    return 'powershell';
  }
  if (normalized === 'js') return 'javascript';
  if (normalized === 'ts') return 'typescript';
  return normalized;
}

function resolveTheme(theme: 'auto' | 'light' | 'dark') {
  if (theme === 'light') return 'sg-light';
  if (theme === 'dark') return 'sg-dark';
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'sg-dark';
  }
  return 'sg-light';
}

function defineSproutGitThemes(monaco: typeof monacoApi) {
  monaco.editor.defineTheme('sg-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '556070', fontStyle: 'italic' },
      { token: 'keyword', foreground: '0B5E3B', fontStyle: 'bold' },
      { token: 'string', foreground: '0A5A9C' },
      { token: 'number', foreground: '825500' },
      { token: 'type', foreground: '5C2F99' },
      { token: 'function', foreground: '7A2E79' },
      { token: 'variable', foreground: '1F2937' },
      { token: 'operator', foreground: '374151' },
      { token: 'delimiter', foreground: '4B5563' },
      { token: 'tag', foreground: '0F5132' },
      { token: 'attribute.name', foreground: '0A5A9C' },
      { token: 'attribute.value', foreground: '0A5A9C' },
    ],
    colors: {
      'editor.background': '#FFFFFF',
      'editor.foreground': '#1E1E2E',
      'editorLineNumber.foreground': '#6B7280',
      'editorLineNumber.activeForeground': '#1F2937',
      'editorCursor.foreground': '#036837',
      'editor.selectionBackground': '#CFE9D9',
      'editor.inactiveSelectionBackground': '#E6F2EC',
      'editor.lineHighlightBackground': '#F3F6F5',
      'editorIndentGuide.background1': '#E2E8F0',
      'editorIndentGuide.activeBackground1': '#94A3B8',
      'editorWhitespace.foreground': '#CBD5E1',
      'editorBracketMatch.border': '#036837',
      'editorBracketMatch.background': '#E6F2EC',
    },
  });

  monaco.editor.defineTheme('sg-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '98A2B3', fontStyle: 'italic' },
      { token: 'keyword', foreground: '6DD3A0', fontStyle: 'bold' },
      { token: 'string', foreground: '7BC5FF' },
      { token: 'number', foreground: 'F2C875' },
      { token: 'type', foreground: 'C9A6FF' },
      { token: 'function', foreground: 'F4A7E7' },
      { token: 'variable', foreground: 'E7ECFF' },
      { token: 'operator', foreground: 'CBD5E1' },
      { token: 'delimiter', foreground: 'B8C2D1' },
      { token: 'tag', foreground: '8BE3AF' },
      { token: 'attribute.name', foreground: '7BC5FF' },
      { token: 'attribute.value', foreground: 'B7DCFF' },
    ],
    colors: {
      'editor.background': '#1A1A2A',
      'editor.foreground': '#CDD6F4',
      'editorLineNumber.foreground': '#7A8399',
      'editorLineNumber.activeForeground': '#D7DEFA',
      'editorCursor.foreground': '#19AC5C',
      'editor.selectionBackground': '#234136',
      'editor.inactiveSelectionBackground': '#1E3530',
      'editor.lineHighlightBackground': '#232338',
      'editorIndentGuide.background1': '#343A53',
      'editorIndentGuide.activeBackground1': '#5C6586',
      'editorWhitespace.foreground': '#4B556F',
      'editorBracketMatch.border': '#6DD3A0',
      'editorBracketMatch.background': '#203A31',
    },
  });
}

export function MonacoEditor({
  value,
  language = 'shell',
  theme = 'auto',
  height = '280px',
  readOnly = false,
  onChange,
}: Props) {
  const [themeName, setThemeName] = useState<'sg-light' | 'sg-dark'>(() => resolveTheme(theme));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monacoApi.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monacoApi | null>(null);
  const suppressRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const el = containerRef.current;
    if (!el) return;

    loader.init().then(monaco => {
      if (disposed || !containerRef.current) return;
      monacoRef.current = monaco;
      defineSproutGitThemes(monaco);

      const editor = monaco.editor.create(containerRef.current, {
        value,
        language: resolveLanguage(language),
        theme: themeName,
        minimap: { enabled: false },
        fontFamily: 'Fira Code, var(--sg-font-code), monospace',
        fontLigatures: true,
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        readOnly,
        wordWrap: 'on',
        tabSize: 2,
        insertSpaces: true,
        padding: { top: 8, bottom: 8 },
      });
      editorRef.current = editor;

      editor.onDidChangeModelContent(() => {
        if (suppressRef.current) return;
        onChange?.(editor.getValue());
      });
    }).catch(() => undefined);

    return () => {
      disposed = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  // Intentionally mount-once: subsequent prop changes handled by dedicated effects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setThemeName(resolveTheme(theme));
  }, [theme]);

  useEffect(() => {
    if (theme !== 'auto' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChangeTheme = () => setThemeName(resolveTheme('auto'));
    mq.addEventListener('change', onChangeTheme);
    return () => mq.removeEventListener('change', onChangeTheme);
  }, [theme]);

  useEffect(() => {
    if (!monacoRef.current) return;
    monacoRef.current.editor.setTheme(themeName);
  }, [themeName]);

  // Ensure language is set on model after mount/change
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    const resolvedLang = resolveLanguage(language);
    if (model.getLanguageId() !== resolvedLang) {
      monacoRef.current.editor.setModelLanguage(model, resolvedLang);
    }
  }, [language]);

  useEffect(() => {
    if (!editorRef.current) return;
    const current = editorRef.current.getValue();
    if (current === value) return;
    suppressRef.current = true;
    editorRef.current.setValue(value);
    suppressRef.current = false;
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden rounded border border-(--sg-input-border)"
      style={{ height }}
    />
  );
}
