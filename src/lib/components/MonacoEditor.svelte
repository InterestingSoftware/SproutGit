<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import loader from "@monaco-editor/loader";

  type Props = {
    value: string;
    language?: string;
    theme?: "auto" | "light" | "dark";
    height?: string;
    readOnly?: boolean;
    onChange?: (next: string) => void;
  };

  let {
    value,
    language = "shell",
    theme = "auto",
    height = "280px",
    readOnly = false,
    onChange = () => {},
  }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let monacoApi: typeof import("monaco-editor") | null = null;
  let editor: import("monaco-editor").editor.IStandaloneCodeEditor | null = null;
  let suppress = false;
  let darkModeMedia: MediaQueryList | null = null;

  function resolvedThemeName(): "vs" | "vs-dark" {
    if (theme === "light") return "vs";
    if (theme === "dark") return "vs-dark";

    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "vs-dark"
        : "vs";
    }

    return "vs-dark";
  }

  function applyTheme() {
    if (!monacoApi || !editor) return;
    monacoApi.editor.setTheme(resolvedThemeName());
  }

  onMount(async () => {
    if (!container) return;

    const monaco = await loader.init();
    monacoApi = monaco;

    const instance = monaco.editor.create(container, {
      value,
      language,
      theme: resolvedThemeName(),
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly,
      wordWrap: "on",
      tabSize: 2,
      insertSpaces: true,
      padding: { top: 8, bottom: 8 },
    });
    editor = instance;

    instance.onDidChangeModelContent(() => {
      if (suppress) return;
      onChange(instance.getValue());
    });

    if (typeof window !== "undefined") {
      darkModeMedia = window.matchMedia("(prefers-color-scheme: dark)");
      const onThemeChange = () => applyTheme();
      darkModeMedia.addEventListener("change", onThemeChange);

      onDestroy(() => {
        darkModeMedia?.removeEventListener("change", onThemeChange);
      });
    }
  });

  $effect(() => {
    applyTheme();
  });

  $effect(() => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (model.getLanguageId() !== language) {
      if (monacoApi) {
        monacoApi.editor.setModelLanguage(model, language);
      }
    }
  });

  $effect(() => {
    if (!editor) return;
    const current = editor.getValue();
    if (current === value) return;
    suppress = true;
    editor.setValue(value);
    suppress = false;
  });

  $effect(() => {
    editor?.updateOptions({ readOnly });
  });

  onDestroy(() => {
    editor?.dispose();
  });
</script>

<div
  bind:this={container}
  class="w-full overflow-hidden rounded border border-[var(--sg-input-border)]"
  style={`height: ${height}`}
></div>
