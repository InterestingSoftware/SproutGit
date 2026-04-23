import type { Update } from '@tauri-apps/plugin-updater';

let available = $state<Update | null>(null);
let checked = $state(false);

export const updateState = {
  get available() {
    return available;
  },
  get checked() {
    return checked;
  },
  set(update: Update | null) {
    available = update;
    checked = true;
  },
};
