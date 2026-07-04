// Type declarations for Monaco side-effect imports
declare module 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
declare module 'monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution';

// Minimal ambient typing for Vite's `?worker` import suffix (from vite/client),
// duplicated narrowly here rather than depending on the `vite` package from a
// non-Vite workspace package. Bundled consumers (the Electron renderer, built
// with electron-vite/Vite) resolve these to a Worker constructor at build time.
declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
