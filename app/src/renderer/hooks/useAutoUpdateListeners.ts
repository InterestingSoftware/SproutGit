import { useEffect } from "react";
import { api } from "../api.js";
import { reportError } from "../error-reporting.js";
import { useUpdateStore } from "../stores/update-store.js";

/** Wires electron-updater's IPC events into the update store. */
export function useAutoUpdateListeners() {
  const { updateState, setUpdateState } = useUpdateStore();

  useEffect(() => {
    const offChecking = api.onUpdateChecking(() =>
      setUpdateState({ status: "checking" }),
    );
    const offAvailable = api.onUpdateAvailable((version: string) =>
      setUpdateState({ status: "available", version }),
    );
    const offNotAvailable = api.onUpdateNotAvailable(() =>
      setUpdateState({ status: "up-to-date" }),
    );
    const offDownloading = api.onUpdateDownloading((progress: number) =>
      setUpdateState({ status: "downloading", progress }),
    );
    const offReady = api.onUpdateReady(() =>
      setUpdateState({ status: "ready" }),
    );
    const offError = api.onUpdateError((message: string) => {
      reportError("Update failed", message);
      setUpdateState({ status: "idle" });
    });
    return () => {
      offChecking();
      offAvailable();
      offNotAvailable();
      offDownloading();
      offReady();
      offError();
    };
  }, [setUpdateState]);

  return updateState;
}
