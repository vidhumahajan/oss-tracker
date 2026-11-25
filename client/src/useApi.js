import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

// Loads data from the API when a component appears, and again whenever
// the path changes.
//   const { data, error, loading, reload } = useApi("/feed");
// Pass null as the path to load nothing (for example while logged out).
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }

    // If the path changes before the answer arrives, this cancels the old
    // request so a slow, outdated answer cannot overwrite a newer one.
    const controller = new AbortController();
    setState((previous) => ({ ...previous, error: null, loading: true }));

    api(path, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name === "AbortError") return;
        setState({ data: null, error, loading: false });
      });

    return () => controller.abort();
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
