import type { Message, OperationTarget, PatternSettings, Shape } from "@furrow/document";
import type { DocumentStore } from "../stores/document-store";
import type { ActionResult } from "../stores/operation-actions";
import {
  addPatternItem,
  convertPatternToDrawing,
  patternBoundary,
  setPatternItem,
} from "../stores/pattern-actions";
import { createEditQueue, type EditResult } from "./edit-queue";
import {
  boundaryCorner,
  boundaryPaths,
  DEFAULT_PATTERN,
  type Generated,
  PATTERN_FAILED,
  type PatternWorkerRequest,
  type PatternWorkerResponse,
} from "./patterns";
import { workerClient } from "./worker-client";

/**
 * Fills the closed paths `targets` select with a pattern of the default
 * settings, anchored at their bounds' bottom-left corner (PRD-0016 P1), its
 * cells generated off the main thread, and adds it as one undo step named
 * `name`. Returns its id.
 */
export async function addPattern(
  store: DocumentStore,
  targets: readonly OperationTarget[],
  name: string,
): Promise<{ ok: true; id: string } | { ok: false; error: Message }> {
  for (;;) {
    const { document } = store.getState();
    const bound = patternBoundary(document, targets);
    if (!bound.ok) return bound;
    const corner = boundaryCorner(document.geometry, bound.boundary);
    const settings: PatternSettings = {
      ...DEFAULT_PATTERN,
      placement: { position: corner, rotation: 0, mirrored: false },
      boundary: bound.boundary,
    };
    const generated = await generatePatternOffThread(document.geometry, settings);
    if (!generated.ok) return generated;
    // Moved or changed meanwhile: fill it where it is now.
    if (store.getState().document.geometry !== document.geometry) continue;
    return { ok: true, id: addPatternItem(store, name, settings, generated.paths) };
  }
}

/**
 * Changes to a pattern's settings: its placement's rotation and position one
 * coordinate at a time, so edits queued together each keep theirs.
 */
export type PatternEdits = Partial<Omit<PatternSettings, "boundary" | "placement">> & {
  rotation?: number;
  mirrored?: boolean;
  x?: number;
  y?: number;
};

/** `pattern` with `edits` applied. */
function edited(pattern: PatternSettings, { rotation, mirrored, x, y, ...edits }: PatternEdits) {
  const { placement } = pattern;
  return {
    ...pattern,
    ...edits,
    placement: {
      ...placement,
      rotation: rotation ?? placement.rotation,
      mirrored: mirrored ?? placement.mirrored,
      position: [x ?? placement.position[0], y ?? placement.position[1]],
    },
  } satisfies PatternSettings;
}
const patternEdits = createEditQueue<PatternSettings, PatternEdits, undefined>({
  read: (store, id) => store.getState().document.drawings.find((d) => d.id === id)?.pattern,
  apply: edited,
  derive: (store, settings) =>
    generatePatternOffThread(store.getState().document.geometry, settings),
  // Its boundary changed, or it moved with it: its settings are new.
  moved: (store, id, before) =>
    store.getState().document.drawings.find((d) => d.id === id)?.pattern !== before,
  commit: (store, id, settings, paths) => ({
    ok: true,
    removedTabs: setPatternItem(store, id, settings, paths),
  }),
});

/**
 * Changes pattern `id`'s settings by `edits` and generates its cells again off
 * the main thread, as one undo step keeping the operations machining it
 * (PRD-0016 P5, `setPatternItem`). Edits made while one is generated are
 * merged and generated next, so a scrub generates once per wait. Moved or
 * its boundary changed meanwhile, it is generated again where it is.
 */
export function editPattern(store: DocumentStore, id: string, edits: PatternEdits) {
  return patternEdits.edit(store, id, edits);
}

/** Resolves once pattern `id` has no edits waiting or being generated, with how the last went. */
export function patternSettled(id: string): Promise<EditResult | null> {
  return patternEdits.settled(id);
}

/**
 * Turns pattern `id` into a plain drawing (PRD-0016 P9) once its pending edits
 * have landed. An undo step left open by a scrub is closed first, so the
 * conversion is one of its own.
 */
export async function convertPattern(store: DocumentStore, id: string): Promise<ActionResult> {
  const pending = await patternSettled(id);
  if (pending && !pending.ok) return pending;
  const state = store.getState();
  if (state.inTransaction) state.commitTransaction();
  convertPatternToDrawing(store, id);
  return { ok: true };
}

// Here, not in `patterns.ts`: the worker imports that, and a worker bundling its own spawn never builds.
const worker = workerClient<PatternWorkerRequest, PatternWorkerResponse>(
  () => new Worker(new URL("../workers/pattern.worker.ts", import.meta.url), { type: "module" }),
  (id) => ({ id, ok: false, error: PATTERN_FAILED }),
);

/**
 * `generatePattern` in a Web Worker (ADR-0004) that stays for the next edit,
 * so a slow pattern never freezes the workspace (PRD-0016 P7).
 */
export async function generatePatternOffThread(
  geometry: readonly Shape[],
  settings: PatternSettings,
): Promise<Generated> {
  const boundary = boundaryPaths(geometry, settings.boundary);
  const { id: _, ...generated } = await worker.post((id) => ({ id, boundary, settings }));
  return generated as Generated;
}
