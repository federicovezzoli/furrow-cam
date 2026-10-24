import { fontName, parseFont } from "@furrow/cam-core";
import {
  MAX_PROJECT_FONTS,
  type Message,
  type ProjectFont,
  sha256Hex,
  type TextSettings,
} from "@furrow/document";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type { DocumentStore } from "../stores/document-store";
import { addFont } from "../stores/font-actions";
import { addTextItem, convertTextToDrawing, setTextItem } from "../stores/geometry-actions";
import type { ActionResult } from "../stores/operation-actions";
import { layoutText, TEXT_LAYOUT_FAILED, TextLayoutError, type UploadedFonts } from "./text-layout";
import type { AssetStore, WorkspaceHost } from "./workspace-host";

/** `layoutText`, with why it failed as a result. */
async function layout(settings: TextSettings, fonts?: UploadedFonts) {
  try {
    return { ok: true as const, paths: await layoutText(settings, fonts) };
  } catch (error) {
    if (!(error instanceof TextLayoutError)) console.error(error);
    const detail = error instanceof TextLayoutError ? error.detail : TEXT_LAYOUT_FAILED;
    return { ok: false as const, error: detail };
  }
}

/**
 * Reads the project's uploaded fonts from `assets`, the host's `fonts`, with
 * whether the document says each is single-stroke (ADR-0062).
 */
export function uploadedFonts(
  store: DocumentStore,
  assets: Pick<AssetStore, "get">,
): UploadedFonts {
  return {
    singleStroke: (sha256) =>
      store.getState().document.fonts.find((listed) => listed.sha256 === sha256)?.singleStroke,
    read: (sha256) => assets.get(sha256),
  };
}

/**
 * Lays `settings` out off the main thread and adds them as a text item, placed
 * like an imported drawing (PRD-0010 T1, `addTextItem`). Returns its id.
 */
export async function addText(
  store: DocumentStore,
  settings: TextSettings,
  fonts?: UploadedFonts,
): Promise<{ ok: true; id: string } | { ok: false; error: Message }> {
  const laid = await layout(settings, fonts);
  return laid.ok ? addTextItem(store, settings, laid.paths) : laid;
}

type Edits = Partial<Omit<TextSettings, "placement">>;
type EditResult = { ok: true; removedTabs: number } | { ok: false; error: Message };

/**
 * A text item's edits waiting to be laid out, merged so the latest value of
 * each setting wins, and the callers waiting on them. One queue runs at a
 * time per item.
 */
type Queue = {
  edits: Edits | null;
  waiting: ((result: EditResult) => void)[];
  fonts?: UploadedFonts;
};
const queues = new Map<string, Queue>();

/**
 * Changes text item `id`'s `edits` and lays it out again off the main thread,
 * as one undo step that keeps its placement and the operations machining it
 * (PRD-0010 T3, `setTextItem`). Edits made while one is laid out are merged
 * and laid out next, the latest value of each setting winning, so a scrub or
 * fast typing lays the text out once per wait rather than once per change.
 * Moved, resized or turned meanwhile, the item is laid out again where it is.
 */
export function editText(
  store: DocumentStore,
  id: string,
  edits: Edits,
  fonts?: UploadedFonts,
): Promise<EditResult> {
  return new Promise((resolve) => {
    const queue = queues.get(id);
    if (queue) {
      queue.edits = { ...queue.edits, ...edits };
      queue.waiting.push(resolve);
      queue.fonts ??= fonts;
      return;
    }
    const started: Queue = { edits, waiting: [resolve], fonts };
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
    const laid = await layout(settings, queue.fonts);
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

/**
 * Uploads `file` into the project as a font (PRD-0010 T7, ADR-0062), after
 * checking it is a font of at most the host's size and that the project has
 * room for it, and lists it in the document as one undo step, `singleStroke`
 * as the user says. Returns its hash, the id text items use it by; a font the
 * project already holds is taken as it is.
 */
export async function uploadFont(
  store: DocumentStore,
  host: Pick<WorkspaceHost, "fonts" | "limits">,
  file: File,
  singleStroke: boolean,
): Promise<{ ok: true; sha256: string } | { ok: false; error: Translatable }> {
  const limits = host.limits.fonts;
  if (!limits) return { ok: false, error: { code: "workspace.fontUploadOff" } };
  if (file.size > limits.maxBytes) {
    return {
      ok: false,
      error: { code: "workspace.fontTooLarge", values: { mb: limits.maxBytes / 1_000_000 } },
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let name: string;
  try {
    name = fontName(parseFont(bytes, singleStroke));
  } catch {
    return { ok: false, error: { code: "workspace.fontUnreadable" } };
  }
  const sha256 = await sha256Hex(bytes);
  const font: ProjectFont = {
    sha256,
    fileName: file.name,
    name: name || file.name.replace(/\.[^.]*$/, ""),
    size: file.size,
    singleStroke,
  };
  const { fonts } = store.getState().document;
  if (fonts.some((listed) => listed.sha256 === sha256)) return { ok: true, sha256 };
  const tooMany: Message = { code: "workspace.tooManyFonts", values: { max: MAX_PROJECT_FONTS } };
  if (fonts.length >= MAX_PROJECT_FONTS) return { ok: false, error: tooMany };
  const upload = await host.fonts.put(sha256, file);
  if (upload.error !== undefined) return { ok: false, error: upload.error };
  // Another font may have been uploaded meanwhile, filling the project.
  if (!addFont(store, font)) {
    if (upload.uploaded) await host.fonts.discard(sha256);
    return { ok: false, error: tooMany };
  }
  return { ok: true, sha256 };
}
