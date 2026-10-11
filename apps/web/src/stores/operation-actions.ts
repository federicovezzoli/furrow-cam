import {
  Name,
  type Operation,
  type ProfileOperation,
  ProfileParams,
  type ProjectDocument,
  type Tool,
} from "@furrow/document";
import type { z } from "zod";
import type { DocumentStore } from "./document-store";

/**
 * Document store actions on operations (ADR-0010): each change is one undo
 * step, or part of the open transaction. Edits that would make the document
 * invalid change nothing and return why.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const OK: ActionResult = { ok: true };

/** New profiles cut through the stock, outside the line, climb milling. */
export function defaultProfileParams(document: ProjectDocument): ProfileParams {
  return {
    side: "outside",
    direction: "climb",
    depth: document.stock.thickness,
    allowance: 0,
    finishPass: false,
    leadIn: null,
    ramp: false,
  };
}

/** `Profile 1`, `Profile 2`, …: the first number no operation's name uses. */
function nextName(document: ProjectDocument, base: string): string {
  const names = new Set(document.operations.map((operation) => operation.name));
  let n = 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** The ids among `shapeIds` that are in the document, once each, in document order. */
function existingShapeIds(document: ProjectDocument, shapeIds: string[]): string[] {
  const wanted = new Set(shapeIds);
  return document.geometry.filter((shape) => wanted.has(shape.id)).map((shape) => shape.id);
}

/**
 * Appends a profile of `shapeIds` (ids no longer in the document are skipped)
 * cut with a snapshot of `tool`. Returns the new operation's id, or `null` if
 * none of the shapes exist.
 */
export function addProfileOperation(
  store: DocumentStore,
  { shapeIds, tool, id = crypto.randomUUID() }: { shapeIds: string[]; tool: Tool; id?: string },
): string | null {
  const { document } = store.getState();
  const shapes = existingShapeIds(document, shapeIds);
  if (shapes.length === 0) return null;
  const operation: ProfileOperation = {
    id,
    type: "profile",
    name: nextName(document, "Profile"),
    enabled: true,
    shapeIds: shapes,
    tool,
    params: defaultProfileParams(document),
  };
  store.getState().change("addOperation", (draft) => {
    draft.operations.push(operation);
  });
  return id;
}

/** Applies `recipe` to the operation `id`, if it still exists. */
function changeOperation(
  store: DocumentStore,
  name: string,
  id: string,
  recipe: (operation: Operation) => void,
) {
  store.getState().change(name, (draft) => {
    const operation = draft.operations.find((candidate) => candidate.id === id);
    if (operation) recipe(operation);
  });
}

function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid value";
}

export function renameOperation(store: DocumentStore, id: string, name: string): ActionResult {
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  changeOperation(store, "renameOperation", id, (operation) => {
    operation.name = parsed.data;
  });
  return OK;
}

export function setOperationEnabled(store: DocumentStore, id: string, enabled: boolean) {
  changeOperation(store, "setOperationEnabled", id, (operation) => {
    operation.enabled = enabled;
  });
}

/** Moves the operation `id` to `index` in the cutting order, clamped to the list. */
export function moveOperation(store: DocumentStore, id: string, index: number) {
  store.getState().change("moveOperation", (draft) => {
    const from = draft.operations.findIndex((operation) => operation.id === id);
    if (from === -1) return;
    const to = Math.max(0, Math.min(draft.operations.length - 1, index));
    if (to === from) return;
    const [operation] = draft.operations.splice(from, 1);
    if (operation) draft.operations.splice(to, 0, operation);
  });
}

export function deleteOperation(store: DocumentStore, id: string) {
  store.getState().change("deleteOperation", (draft) => {
    const index = draft.operations.findIndex((operation) => operation.id === id);
    if (index !== -1) draft.operations.splice(index, 1);
  });
}

/** Replaces the operation's tool with a snapshot of `tool` (ADR-0003). */
export function setOperationTool(store: DocumentStore, id: string, tool: Tool) {
  changeOperation(store, "setOperationTool", id, (operation) => {
    operation.tool = tool;
  });
}

/** Sets the shapes the operation cuts; ids no longer in the document are skipped. */
export function setOperationShapes(
  store: DocumentStore,
  id: string,
  shapeIds: string[],
): ActionResult {
  const shapes = existingShapeIds(store.getState().document, shapeIds);
  if (shapes.length === 0) return { ok: false, error: "An operation needs at least one shape" };
  changeOperation(store, "setOperationShapes", id, (operation) => {
    operation.shapeIds = shapes;
  });
  return OK;
}

/**
 * Changes some of a profile's params at once, e.g. the side and the allowance
 * it requires. Rejected unless the result is valid `ProfileParams`.
 */
export function updateProfileParams(
  store: DocumentStore,
  id: string,
  changes: Partial<ProfileParams>,
): ActionResult {
  const operation = store.getState().document.operations.find((candidate) => candidate.id === id);
  if (operation?.type !== "profile") return { ok: false, error: "Not a profile operation" };
  const parsed = ProfileParams.safeParse({ ...operation.params, ...changes });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  changeOperation(store, "updateProfileParams", id, (draft) => {
    // Field by field, so unchanged values record no patches.
    if (draft.type === "profile") Object.assign(draft.params, changes);
  });
  return OK;
}
