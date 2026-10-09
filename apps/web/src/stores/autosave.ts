import type { ProjectDocument } from "@furrow/document";
import type { DocumentStore } from "./document-store";

/**
 * Whether the document on screen matches the one stored on the server.
 * `error`: the server couldn't be reached; the next change retries.
 * `failed`: the server refused the save (e.g. the project was changed
 * elsewhere); retrying can't help, so autosave stops.
 */
export type SaveState = "saved" | "unsaved" | "saving" | "error" | "failed";

/** `savedAt` is the server's `updatedAt` for the last save; `error` explains a failed one. */
export type AutosaveStatus = { state: SaveState; savedAt: Date; error?: string };

export type SaveDocument = (
  document: ProjectDocument,
  /** The version being replaced, for the server's conflict check. */
  savedAt: Date,
) => Promise<{ updatedAt: Date; error?: never } | { error: string }>;

export type Autosave = ReturnType<typeof createAutosave>;

export const OFFLINE = "The project couldn't be saved. Check your connection.";

/**
 * Saves the store's document `delay` ms after the last change (ADR-0010), while
 * started. Never saves mid-transaction: an open gesture waits for its commit.
 * One save runs at a time; changes made meanwhile are saved after it.
 *
 * Create one per document store and start/stop it with the workspace, so
 * stopping and starting again (navigating away and back) keeps track of what
 * the server has.
 */
export function createAutosave(
  store: DocumentStore,
  {
    savedAt,
    save,
    delay,
  }: {
    /** `updatedAt` of the document the store was created with. */
    savedAt: Date;
    save: SaveDocument;
    delay: number;
  },
) {
  let status: AutosaveStatus = { state: "saved", savedAt };
  let savedDocument = store.getState().document;
  let saving = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  const listeners = new Set<() => void>();

  function update(state: SaveState, error?: string) {
    status =
      error === undefined
        ? { state, savedAt: status.savedAt }
        : { state, savedAt: status.savedAt, error };
    for (const listener of listeners) listener();
  }

  /** Whether `document` has the contents last saved, even if it's another object (after an undo). */
  function isSaved(document: ProjectDocument) {
    if (document === savedDocument) return true;
    if (!sameValue(document, savedDocument)) return false;
    savedDocument = document;
    return true;
  }

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (status.state === "failed") return;
    if (saving) {
      // `run` checks again once the current save is done.
      if (status.state !== "saving") update("saving");
      return;
    }
    const { document, inTransaction } = store.getState();
    // Mid-gesture, skip the deep comparison: changes can come at pointer-move rate.
    const saved = inTransaction ? document === savedDocument : isSaved(document);
    if (saved) {
      if (status.state !== "saved") update("saved");
      return;
    }
    if (status.state !== "unsaved") update("unsaved");
    if (!inTransaction) timer = setTimeout(run, delay);
  }

  async function run() {
    timer = undefined;
    if (saving || status.state === "failed") return;
    const { document, inTransaction } = store.getState();
    if (inTransaction || isSaved(document)) return;

    saving = true;
    update("saving");
    let result: Awaited<ReturnType<SaveDocument>>;
    try {
      result = await save(document, status.savedAt);
    } catch {
      saving = false;
      update("error", OFFLINE);
      return;
    }
    saving = false;

    if (result.error !== undefined) {
      update("failed", result.error);
      return;
    }
    savedDocument = document;
    status = { ...status, savedAt: result.updatedAt };
    if (started) {
      schedule();
      return;
    }
    // Stopped during the save: changes made meanwhile still go out now.
    void run();
    if (!saving) update(isSaved(store.getState().document) ? "saved" : "unsaved");
  }

  function flush() {
    clearTimeout(timer);
    void run();
  }

  return {
    get status() {
      return status;
    },
    /** For `useSyncExternalStore`. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Starts watching the store; returns `stop`. */
    start() {
      if (!started) {
        started = true;
        unsubscribe = store.subscribe((state, prev) => {
          if (state.document !== prev.document || state.inTransaction !== prev.inTransaction) {
            schedule();
          }
        });
        schedule();
      }
      return () => this.stop();
    },
    /** Stops watching the store; pending changes are saved now. */
    stop() {
      if (!started) return;
      started = false;
      unsubscribe?.();
      flush();
    },
    /** Saves pending changes now instead of waiting for the delay. */
    flush,
  };
}

/**
 * Deep equality of JSON values. Identical references short-circuit, so
 * comparing two versions of an Immer-produced document only walks what changed.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
