import type { ProjectDocument } from "@furrow/document";
import { applyPatches, type Draft, enablePatches, type Patch, produceWithPatches } from "immer";
import { devtools } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

enablePatches();

/** One undo step: `patches` redo it, `inversePatches` undo it. */
export type HistoryEntry = { patches: Patch[]; inversePatches: Patch[] };

/** Undo steps kept; older ones are dropped. */
export const MAX_HISTORY = 200;

export type DocumentState = {
  /** The open project's document (ADR-0003), always valid for the current schema version. */
  document: ProjectDocument;
  /** Undo steps, oldest first. */
  past: HistoryEntry[];
  /** Redo steps, the next one last. Cleared by any new change. */
  future: HistoryEntry[];
  /** Whether a transaction is open: its changes are applied to `document` but not yet in `past`. */
  inTransaction: boolean;

  /**
   * Applies `recipe` to the document as one undo step, or as part of the open
   * transaction. Feature actions (edit stock, add operation, …) are built on
   * this; components call those, never `setState` (ADR-0010).
   */
  change: (name: string, recipe: (draft: Draft<ProjectDocument>) => void) => void;
  /**
   * Starts a continuous gesture (dragging, scrubbing a value): its changes show
   * live but become a single undo step on `commitTransaction`. Does nothing if
   * one is already open.
   */
  beginTransaction: () => void;
  commitTransaction: () => void;
  /** Reverts the open transaction's changes, e.g. when a drag is cancelled with Escape. */
  cancelTransaction: () => void;
  /** Undo and redo do nothing mid-transaction. */
  undo: () => void;
  redo: () => void;
  /**
   * Replaces the document with one loaded from the server (a restored
   * version), which isn't an undo step: undo/redo history is cleared and any
   * open transaction dropped.
   */
  load: (document: ProjectDocument) => void;
  /**
   * The version last saved or restored in this session while the document
   * is still that version, or `null`: the live document isn't linked to a
   * version (ADR-0028), so any change, undo, redo or load drops it.
   */
  version: { id: string; label: string | null } | null;
  /** Records the document as it is now as `version`, or that it is none. */
  markVersion: (version: { id: string; label: string | null } | null) => void;
};

/** The label of the version the document is, `null` once changed since or if unlabelled. */
export function versionLabel({ version }: DocumentState): string | null {
  return version?.label ?? null;
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;

/** Whether the document has an operation to cut, which exporting and simulating need. */
export function hasEnabledOperations({ document }: DocumentState): boolean {
  return document.operations.some((operation) => operation.enabled);
}

/**
 * The open transaction: only the document it started from. A gesture makes a
 * change per pointer move or scrub step, and keeping each one's patches would
 * keep a copy of whatever it rewrote (a drawing's shapes) per move until undo
 * drops it.
 */
type Transaction = { start: ProjectDocument };

/**
 * The transaction's changes as one undo step, or `null` if there were none:
 * a replacement of each top-level field the gesture changed, old and new.
 */
function transactionEntry({ start }: Transaction, end: ProjectDocument): HistoryEntry | null {
  const keys = (Object.keys(end) as (keyof ProjectDocument)[]).filter(
    (key) => end[key] !== start[key],
  );
  if (keys.length === 0) return null;
  return {
    patches: keys.map((key) => ({ op: "replace", path: [key], value: end[key] })),
    inversePatches: keys.map((key) => ({ op: "replace", path: [key], value: start[key] })),
  };
}

/** A document store for one open project, with an empty history. */
export function createDocumentStore(document: ProjectDocument) {
  let transaction: Transaction | null = null;

  return createStore<DocumentState>()(
    devtools(
      (set, get) => ({
        document,
        past: [],
        future: [],
        inTransaction: false,
        version: null,

        change(name, recipe) {
          const { document, past } = get();
          const [next, patches, inversePatches] = produceWithPatches(document, recipe);
          if (patches.length === 0) return;
          if (transaction) {
            set({ document: next, version: null }, false, name);
          } else {
            set(
              {
                document: next,
                past: [...past, { patches, inversePatches }].slice(-MAX_HISTORY),
                future: [],
                version: null,
              },
              false,
              name,
            );
          }
        },

        beginTransaction() {
          if (transaction) return;
          transaction = { start: get().document };
          set({ inTransaction: true }, false, "beginTransaction");
        },

        commitTransaction() {
          if (!transaction) return;
          const entry = transactionEntry(transaction, get().document);
          transaction = null;
          if (!entry) {
            set({ inTransaction: false }, false, "commitTransaction");
            return;
          }
          set(
            {
              past: [...get().past, entry].slice(-MAX_HISTORY),
              future: [],
              inTransaction: false,
            },
            false,
            "commitTransaction",
          );
        },

        cancelTransaction() {
          if (!transaction) return;
          const { start } = transaction;
          transaction = null;
          set(
            {
              document: start,
              inTransaction: false,
            },
            false,
            "cancelTransaction",
          );
        },

        undo() {
          const { document, past, future } = get();
          const entry = past.at(-1);
          if (transaction || !entry) return;
          set(
            {
              document: applyPatches(document, entry.inversePatches),
              past: past.slice(0, -1),
              future: [...future, entry],
              version: null,
            },
            false,
            "undo",
          );
        },

        redo() {
          const { document, past, future } = get();
          const entry = future.at(-1);
          if (transaction || !entry) return;
          set(
            {
              document: applyPatches(document, entry.patches),
              past: [...past, entry],
              future: future.slice(0, -1),
              version: null,
            },
            false,
            "redo",
          );
        },

        load(document) {
          transaction = null;
          set(
            { document, past: [], future: [], inTransaction: false, version: null },
            false,
            "load",
          );
        },

        markVersion(version) {
          set({ version }, false, "markVersion");
        },
      }),
      { name: "document", enabled: process.env.NODE_ENV !== "production" },
    ),
  );
}
