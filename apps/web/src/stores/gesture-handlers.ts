import type { DocumentStore } from "./document-store";

/**
 * Handlers for a `NumberField`'s gestures (a scrub, a held arrow key): the
 * changes during one become a single undo step, and Escape reverts them
 * (ADR-0010).
 */
export function gestureHandlers(store: DocumentStore) {
  return {
    onGestureStart: () => store.getState().beginTransaction(),
    onGestureEnd: (cancelled: boolean) => {
      const state = store.getState();
      if (cancelled) state.cancelTransaction();
      else state.commitTransaction();
    },
  };
}
