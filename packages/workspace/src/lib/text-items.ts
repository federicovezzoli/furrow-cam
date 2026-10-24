import type { Message, TextSettings } from "@furrow/document";
import type { DocumentStore } from "../stores/document-store";
import { addTextItem, convertTextToDrawing, setTextItem } from "../stores/geometry-actions";
import type { ActionResult } from "../stores/operation-actions";
import { layoutText, TEXT_LAYOUT_FAILED, TextLayoutError } from "./text-layout";

/** `layoutText`, with why it failed as a result. */
async function layout(settings: TextSettings) {
  try {
    return { ok: true as const, paths: await layoutText(settings) };
  } catch (error) {
    if (!(error instanceof TextLayoutError)) console.error(error);
    const detail = error instanceof TextLayoutError ? error.detail : TEXT_LAYOUT_FAILED;
    return { ok: false as const, error: detail };
  }
}

/**
 * Lays `settings` out off the main thread and adds them as a text item, placed
 * like an imported drawing (PRD-0010 T1, `addTextItem`). Returns its id.
 */
export async function addText(
  store: DocumentStore,
  settings: TextSettings,
): Promise<{ ok: true; id: string } | { ok: false; error: Message }> {
  const laid = await layout(settings);
  return laid.ok ? addTextItem(store, settings, laid.paths) : laid;
}

type Edits = Partial<Omit<TextSettings, "placement">>;
type EditResult = { ok: true; removedTabs: number } | { ok: false; error: Message };

/**
 * A text item's edits waiting to be laid out, merged so the latest value of
 * each setting wins, and the callers waiting on them. One queue runs at a
 * time per item.
 */
type Queue = { edits: Edits | null; waiting: ((result: EditResult) => void)[] };
const queues = new Map<string, Queue>();

/**
 * Changes text item `id`'s `edits` and lays it out again off the main thread,
 * as one undo step that keeps its placement and the operations machining it
 * (PRD-0010 T3, `setTextItem`). Edits made while one is laid out are merged
 * and laid out next, the latest value of each setting winning, so a scrub or
 * fast typing lays the text out once per wait rather than once per change.
 * Moved, resized or turned meanwhile, the item is laid out again where it is.
 */
export function editText(store: DocumentStore, id: string, edits: Edits): Promise<EditResult> {
  return new Promise((resolve) => {
    const queue = queues.get(id);
    if (queue) {
      queue.edits = { ...queue.edits, ...edits };
      queue.waiting.push(resolve);
      return;
    }
    const started: Queue = { edits, waiting: [resolve] };
    queues.set(id, started);
    void run(store, id, started);
  });
}

/**
 * Resolves once text item `id` has no edits waiting or being laid out, with
 * how the last went, or `null` if none was.
 */
export function textSettled(id: string): Promise<EditResult | null> {
  const queue = queues.get(id);
  return queue ? new Promise((resolve) => queue.waiting.push(resolve)) : Promise.resolve(null);
}

/**
 * Turns text item `id` into a drawing (PRD-0010 T8, `convertTextToDrawing`)
 * once its pending edits have landed, e.g. the one leaving the text field to
 * click *Convert* starts. Refuses, converting nothing, if that edit was
 * refused, so what was typed isn't lost. An undo step left open by a scrub
 * is closed first, so the conversion is one of its own.
 */
export async function convertText(store: DocumentStore, id: string): Promise<ActionResult> {
  const pending = await textSettled(id);
  if (pending && !pending.ok) return pending;
  const state = store.getState();
  if (state.inTransaction) state.commitTransaction();
  convertTextToDrawing(store, id);
  return { ok: true };
}

async function run(store: DocumentStore, id: string, queue: Queue) {
  let result: EditResult = { ok: true, removedTabs: 0 };
  while (queue.edits) {
    const edits = queue.edits;
    queue.edits = null;
    const text = currentText(store, id);
    if (!text) break;
    const settings = { ...text, ...edits };
    const laid = await layout(settings);
    // Read again: `editText` may have queued newer edits during the layout.
    const newer = queue.edits as Edits | null;
    if (newer) {
      // Lay theirs out over these instead.
      queue.edits = { ...edits, ...newer };
      continue;
    }
    if (!laid.ok) {
      result = laid;
      break;
    }
    // Moved, resized or turned meanwhile: lay it out again where it is now.
    if (currentText(store, id) !== text) {
      queue.edits = edits;
      continue;
    }
    result = setTextItem(store, id, settings, laid.paths);
  }
  queues.delete(id);
  for (const resolve of queue.waiting) resolve(result);
}

function currentText(store: DocumentStore, id: string) {
  return store.getState().document.drawings.find((drawing) => drawing.id === id)?.text;
}
