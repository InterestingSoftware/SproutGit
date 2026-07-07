import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Lists the shells available for the terminal's "choose shell" picker. */
export function useAvailableShells() {
  const [availableShells, setAvailableShells] = useState<
    { name: string; path: string }[]
  >([]);

  useEffect(() => {
    // Intentionally silent: worst case the shell picker just shows no options.
    void api
      .listShells()
      .then(setAvailableShells)
      .catch(() => undefined);
  }, []);

  return availableShells;
}
