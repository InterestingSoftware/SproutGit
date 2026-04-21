declare module '@tauri-apps/plugin-updater' {
  export type Update = {
    version: string;
    downloadAndInstall(): Promise<void>;
  };

  export function check(): Promise<Update | null>;
}

declare module '@tauri-apps/plugin-process' {
  export function relaunch(): Promise<void>;
}

export {};