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
};

export type DocumentStore = ReturnType<typeof createDocumentStore>;

/**
 * Patches of the open transaction. Kept out of the state and appended in
 * place: a gesture can make a change per pointer move, and copying the
 * arrays on each one would be quadratic.
 */
class Transaction {
  private readonly patches: Patch[] = [];
  /** One array per change, undone last change first. */
  private readonly inverseChunks: Patch[][] = [];

  add(patches: Patch[], inversePatches: Patch[]) {
    this.patches.push(...patches);
    this.inverseChunks.push(inversePatches);
  }

  /** The changes as one undo step, or `null` if there were none. */
  entry(): HistoryEntry | null {
    if (this.patches.length === 0) return null;
    return { patches: this.patches, inversePatches: this.inverseChunks.slice().reverse().flat() };
  }
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

        change(name, recipe) {
          const { document, past } = get();
          const [next, patches, inversePatches] = produceWithPatches(document, recipe);
          if (patches.length === 0) return;
          if (transaction) {
            transaction.add(patches, inversePatches);
            set({ document: next }, false, name);
          } else {
            set(
              {
                document: next,
                past: [...past, { patches, inversePatches }].slice(-MAX_HISTORY),
                future: [],
              },
              false,
              name,
            );
          }
        },

        beginTransaction() {
          if (transaction) return;
          transaction = new Transaction();
          set({ inTransaction: true }, false, "beginTransaction");
        },

        commitTransaction() {
          if (!transaction) return;
          const entry = transaction.entry();
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
          const entry = transaction.entry();
          transaction = null;
          set(
            {
              document: entry ? applyPatches(get().document, entry.inversePatches) : get().document,
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
            },
            false,
            "redo",
          );
        },
      }),
      { name: "document", enabled: process.env.NODE_ENV !== "production" },
    ),
  );
}
