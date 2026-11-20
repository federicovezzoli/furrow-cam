import type { Message, Path } from "@furrow/document";
import type { DocumentStore } from "../stores/document-store";

/** How an edit of derived paths (a text item's outlines, a pattern's cells) went. */
export type EditResult = { ok: true; removedTabs: number } | { ok: false; error: Message };

type Derived = { ok: true; paths: Path[] } | { ok: false; error: Message };

/**
 * Edits of an item whose paths are derived off the main thread from its
 * settings (ADR-0059, ADR-0087): `read` gives its settings now, `apply` edits
 * them, `derive` computes the paths with the context the first edit gave, and
 * `commit` stores them as one undo step. `moved` says whether the item, or
 * what it derives from, changed since `before` was read.
 */
export function createEditQueue<Settings, Edits extends object, Context>(steps: {
  read: (store: DocumentStore, id: string) => Settings | undefined;
  apply: (settings: Settings, edits: Edits) => Settings;
  derive: (
    store: DocumentStore,
    settings: Settings,
    context: Context | undefined,
  ) => Promise<Derived>;
  moved: (store: DocumentStore, id: string, before: Settings) => boolean;
  commit: (store: DocumentStore, id: string, settings: Settings, paths: Path[]) => EditResult;
}) {
  /** An item's edits waiting, merged so the latest of each wins, and who waits on them. */
  type Queue = {
    edits: Edits | null;
    waiting: ((result: EditResult) => void)[];
    context?: Context;
  };
  const queues = new Map<string, Queue>();

  async function run(store: DocumentStore, id: string, queue: Queue) {
    let result: EditResult = { ok: true, removedTabs: 0 };
    while (queue.edits) {
      const edits = queue.edits;
      queue.edits = null;
      const before = steps.read(store, id);
      if (before === undefined) break;
      const settings = steps.apply(before, edits);
      const derived = await steps.derive(store, settings, queue.context);
      // Read again: `edit` may have queued newer edits meanwhile; derive theirs over these.
      const newer = queue.edits as Edits | null;
      if (newer) {
        queue.edits = { ...edits, ...newer };
        continue;
      }
      if (!derived.ok) {
        result = derived;
        break;
      }
      // Moved, resized or turned meanwhile: derive it again where it is now.
      if (steps.moved(store, id, before)) {
        queue.edits = edits;
        continue;
      }
      result = steps.commit(store, id, settings, derived.paths);
    }
    queues.delete(id);
    for (const resolve of queue.waiting) resolve(result);
  }

  return {
    /**
     * Applies `edits` to item `id` and derives it again, as one undo step.
     * Edits made while one is derived are merged and derived next, so a
     * scrub or fast typing derives once per wait rather than once per change.
     */
    edit(store: DocumentStore, id: string, edits: Edits, context?: Context): Promise<EditResult> {
      return new Promise((resolve) => {
        const queue = queues.get(id);
        if (queue) {
          queue.edits = { ...queue.edits, ...edits };
          queue.waiting.push(resolve);
          queue.context ??= context;
          return;
        }
        const started: Queue = { edits, waiting: [resolve], context };
        queues.set(id, started);
        void run(store, id, started);
      });
    },
    /** Resolves once item `id` has no edits waiting or being derived, with how the last went, or `null` if none was. */
    settled(id: string): Promise<EditResult | null> {
      const queue = queues.get(id);
      return queue ? new Promise((resolve) => queue.waiting.push(resolve)) : Promise.resolve(null);
    },
  };
}
