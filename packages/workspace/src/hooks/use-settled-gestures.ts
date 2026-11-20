import { useRef } from "react";
import { useDocumentStoreApi } from "../providers/workspace-stores";

/**
 * Edits that land off the main thread (a text item's layout, a pattern's
 * cells) made one undo step per scrub or held arrow: `gestures` open a
 * transaction and commit it once `settled` resolves, after the gesture's
 * edits have landed. `afterPending` runs a step once the gesture start or end
 * still waiting for the one before has run, so each gesture is its own step;
 * edits await `pending` first.
 */
export function useSettledGestures(settled: () => Promise<unknown>) {
  const store = useDocumentStoreApi();
  const pending = useRef<Promise<void> | null>(null);
  function afterPending(step: () => void | Promise<void>): Promise<void> {
    const next = (pending.current ?? Promise.resolve()).then(step);
    pending.current = next;
    void next.finally(() => {
      if (pending.current === next) pending.current = null;
    });
    return next;
  }
  const gestures = {
    onGestureStart: () => {
      const begin = () => store.getState().beginTransaction();
      if (pending.current) void afterPending(begin);
      else begin();
    },
    onGestureEnd: (cancelled: boolean) =>
      afterPending(async () => {
        await settled();
        const state = store.getState();
        if (cancelled) state.cancelTransaction();
        else state.commitTransaction();
      }),
  };
  return { gestures, pending };
}
