import type { Message, ProjectDocument } from "@furrow/document";
import type { SaveResult } from "../lib/workspace-host";
import type { DocumentStore } from "./document-store";

/**
 * Whether the document on screen matches the one stored on the server.
 * `error`: the server couldn't be reached, or refused a save the user can
 * fix (`retryable`, e.g. signed out); the next change, or a flush, retries.
 * `failed`: the server refused the save for good (e.g. the project was
 * changed elsewhere); retrying can't help, so autosave stops.
 */
export type SaveState = "saved" | "unsaved" | "saving" | "error" | "failed";

/** `savedAt` is the server's `updatedAt` for the last save; `error` explains a failed one. */
export type AutosaveStatus = { state: SaveState; savedAt: Date; error?: string | Message };

export type SaveDocument = (
  document: ProjectDocument,
  /** The version being replaced, for the server's conflict check. */
  savedAt: Date,
) => Promise<SaveResult>;

export type Autosave = ReturnType<typeof createAutosave>;

export const OFFLINE: Message = { code: "workspace.offline" };

/** The least time between two `retry` calls that save, so focus and online events don't each send the document. */
export const RETRY_INTERVAL = 10_000;

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
  /** The running save, settled either way; resolves when it's done. */
  let inFlight: Promise<unknown> = Promise.resolve();
  let started = false;
  /** While held, no save starts: the server's document is being replaced (a restore). */
  let held = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRetry = Number.NEGATIVE_INFINITY;
  let unsubscribe: (() => void) | undefined;
  const listeners = new Set<() => void>();

  function update(state: SaveState, error?: string | Message) {
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
    if (saving || held || status.state === "failed") return;
    const { document, inTransaction } = store.getState();
    if (inTransaction || isSaved(document)) return;

    saving = true;
    update("saving");
    let result: Awaited<ReturnType<SaveDocument>>;
    try {
      const saved = save(document, status.savedAt);
      inFlight = saved.catch(() => {});
      result = await saved;
    } catch {
      saving = false;
      update("error", OFFLINE);
      return;
    }
    saving = false;

    if (result.error !== undefined) {
      update(result.retryable ? "error" : "failed", result.error);
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

  /**
   * Saves pending changes now and resolves with the status once no save is
   * running: `saved` if the server has what's on screen. A connection error
   * isn't retried more than once.
   */
  async function settle(): Promise<AutosaveStatus> {
    let attempted = false;
    for (;;) {
      clearTimeout(timer);
      timer = undefined;
      if (saving) {
        await inFlight;
        continue;
      }
      if (attempted && status.state === "error") return status;
      attempted = true;
      const running = run();
      if (!saving) return status;
      await running;
    }
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
    /**
     * After a save that can be retried failed, tries again now, e.g. when the
     * user comes back to the window. Not again within `RETRY_INTERVAL`.
     */
    retry() {
      if (status.state !== "error" || Date.now() - lastRetry < RETRY_INTERVAL) return;
      lastRetry = Date.now();
      flush();
    },
    settle,
    /**
     * Settles, then holds: no save starts until `release`, while the server's
     * document is replaced (a restore). Resolves with the settled status;
     * `release` must follow either way.
     */
    async hold(): Promise<AutosaveStatus> {
      const settled = await settle();
      held = true;
      clearTimeout(timer);
      timer = undefined;
      return settled;
    },
    /**
     * Lets saves start again. `restored` is the document the server stored
     * while held and when: autosave starts over from it. Load it into the
     * store right after; changes made while held are replaced by it.
     */
    release(restored?: { document: ProjectDocument; savedAt: Date }) {
      held = false;
      if (restored) {
        savedDocument = restored.document;
        status = { state: "saved", savedAt: restored.savedAt };
        for (const listener of listeners) listener();
        // Loading it into the store schedules what's next.
        return;
      }
      if (started) schedule();
    },
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
