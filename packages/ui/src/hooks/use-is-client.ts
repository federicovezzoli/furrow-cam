import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` while server rendering and hydrating, `true` once running in the
 * browser. For values only the browser knows (time zone, chosen theme).
 */
export function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
