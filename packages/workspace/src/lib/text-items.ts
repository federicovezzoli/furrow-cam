import type { Message, TextSettings } from "@furrow/document";
import type { DocumentStore } from "../stores/document-store";
import { addTextItem, DRAWINGS_OR_MODEL, setTextItem } from "../stores/geometry-actions";
import type { ActionResult } from "../stores/operation-actions";
import { layoutText, TextLayoutError } from "./text-layout";

const FAILED: Message = { code: "workspace.textLayoutFailed" };
const NO_OUTLINES: Message = { code: "workspace.textNoOutlines" };

/** `layoutText`, with why it failed as a result. */
async function layout(settings: TextSettings) {
  try {
    return { ok: true as const, paths: await layoutText(settings) };
  } catch (error) {
    if (!(error instanceof TextLayoutError)) console.error(error);
    return { ok: false as const, error: error instanceof TextLayoutError ? error.detail : FAILED };
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
  if (!laid.ok) return laid;
  if (laid.paths.length === 0) return { ok: false, error: NO_OUTLINES };
  const id = addTextItem(store, settings, laid.paths);
  // A model was imported, or a step redone, while the text was laid out.
  return id === null ? { ok: false, error: DRAWINGS_OR_MODEL } : { ok: true, id };
}

/**
 * Changes text item `id`'s `edits` and lays it out again off the main thread,
 * as one undo step that keeps its placement and the operations machining it
 * (PRD-0010 T3, `setTextItem`). Moved, resized or turned while it was laid
 * out, it is laid out again where it is now.
 */
export async function editText(
  store: DocumentStore,
  id: string,
  edits: Partial<Omit<TextSettings, "placement">>,
): Promise<ActionResult> {
  for (;;) {
    const text = currentText(store, id);
    if (!text) return { ok: true };
    const settings = { ...text, ...edits };
    const laid = await layout(settings);
    if (!laid.ok) return laid;
    if (currentText(store, id) === text) return setTextItem(store, id, settings, laid.paths);
  }
}

function currentText(store: DocumentStore, id: string) {
  return store.getState().document.drawings.find((drawing) => drawing.id === id)?.text;
}
