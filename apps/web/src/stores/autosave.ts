import type { ProjectDocument } from "@furrow/document";
import type { DocumentStore } from "./document-store";

/** Whether the document on screen matches the one stored on the server. */
export type SaveState = "saved" | "unsaved" | "saving" | "error";

/** `savedAt` is the server's `updatedAt` for the last save; `error` explains a failed one. */
export type AutosaveStatus = { state: SaveState; savedAt: Date; error?: string };

export type SaveDocument = (
  document: ProjectDocument,
  /** The version being replaced, for the server's conflict check. */
  savedAt: Date,
) => Promise<{ updatedAt: Date; error?: never } | { error: string }>;

export const OFFLINE = "The project couldn't be saved. Check your connection.";

/**
 * Saves the document `delay` ms after the last change (ADR-0010). Never saves
 * mid-transaction: an open gesture waits for its commit. One save runs at a
 * time; changes made meanwhile are saved after it. A failed save is retried
 * on the next change.
 */
export function createAutosave(
  store: DocumentStore,
  {
    savedAt,
    save,
    delay,
    onStatus,
  }: {
    /** `updatedAt` of the document the store was created with. */
    savedAt: Date;
    save: SaveDocument;
    delay: number;
    onStatus: (status: AutosaveStatus) => void;
  },
) {
  let status: AutosaveStatus = { state: "saved", savedAt };
  let savedDocument = store.getState().document;
  let saving = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function update(state: SaveState, error?: string) {
    status =
      error === undefined
        ? { state, savedAt: status.savedAt }
        : { state, savedAt: status.savedAt, error };
    onStatus(status);
  }

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    const { document, transaction } = store.getState();
    if (saving) {
      // `run` checks again once the current save is done.
      if (status.state !== "saving") update("saving");
      return;
    }
    if (document === savedDocument) {
      if (status.state !== "saved") update("saved");
      return;
    }
    if (status.state !== "unsaved") update("unsaved");
    if (!transaction) timer = setTimeout(run, delay);
  }

  async function run() {
    timer = undefined;
    const { document, transaction } = store.getState();
    if (saving || transaction || document === savedDocument) return;

    saving = true;
    update("saving");
    let result: Awaited<ReturnType<SaveDocument>>;
    try {
      result = await save(document, status.savedAt);
    } catch {
      result = { error: OFFLINE };
    }
    saving = false;

    if (result.error !== undefined) {
      update("error", result.error);
      return;
    }
    savedDocument = document;
    status = { ...status, savedAt: result.updatedAt };
    // Still report the new version after `dispose`: the next autosave continues from it.
    if (disposed) update("saved");
    else schedule();
  }

  const unsubscribe = store.subscribe((state, prev) => {
    if (state.document !== prev.document || state.transaction !== prev.transaction) schedule();
  });

  return {
    get status() {
      return status;
    },
    /** Saves a pending change now instead of waiting for the delay. */
    flush() {
      if (timer === undefined) return;
      clearTimeout(timer);
      void run();
    },
    /** Stops watching the store; a pending change is saved first. */
    dispose() {
      unsubscribe();
      this.flush();
      disposed = true;
    },
  };
}
