import { autoTabPositions, type TabPlacement } from "@furrow/cam-core";
import {
  canDrill,
  DrillParams,
  Name,
  Operation,
  PocketParams,
  type Point,
  type ProfileOperation,
  ProfileParams,
  type ProfileTabs,
  type ProjectDocument,
  type Shape,
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
    tabs: null,
  };
}

/**
 * New pockets go half through the stock, climb milling, ramping in: an end
 * mill plunging straight into the middle of a pocket has nowhere to clear its
 * chips.
 */
export function defaultPocketParams(document: ProjectDocument): PocketParams {
  return {
    direction: "climb",
    depth: document.stock.thickness / 2,
    allowance: 0,
    finishPass: false,
    ramp: true,
  };
}

/**
 * New drill operations go through the stock, pecking: a hole no deeper than
 * the tool's step-down is a single plunge anyway.
 */
export function defaultDrillParams(document: ProjectDocument): DrillParams {
  return { depth: document.stock.thickness, peck: true };
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
export function addProfileOperation(store: DocumentStore, options: NewOperation): string | null {
  return appendOperation(store, options, (document, fields) => ({
    ...fields,
    type: "profile",
    name: nextName(document, "Profile"),
    params: defaultProfileParams(document),
  }));
}

/** Appends a pocket of `shapeIds`, like `addProfileOperation`. */
export function addPocketOperation(store: DocumentStore, options: NewOperation): string | null {
  return appendOperation(store, options, (document, fields) => ({
    ...fields,
    type: "pocket",
    name: nextName(document, "Pocket"),
    params: defaultPocketParams(document),
  }));
}

/**
 * Appends a drill operation on `shapeIds`, like `addProfileOperation`.
 * Returns `null` as well if `tool` can't drill.
 */
export function addDrillOperation(store: DocumentStore, options: NewOperation): string | null {
  if (!canDrill(options.tool)) return null;
  return appendOperation(store, options, (document, fields) => ({
    ...fields,
    type: "drill",
    name: nextName(document, "Drill"),
    params: defaultDrillParams(document),
  }));
}

type NewOperation = { shapeIds: string[]; tool: Tool; id?: string };

type OperationFields = Pick<Operation, "id" | "enabled" | "shapeIds" | "tool">;

function appendOperation(
  store: DocumentStore,
  { shapeIds, tool, id = crypto.randomUUID() }: NewOperation,
  create: (document: ProjectDocument, fields: OperationFields) => Operation,
): string | null {
  const { document } = store.getState();
  const shapes = existingShapeIds(document, shapeIds);
  if (shapes.length === 0) return null;
  const operation = create(document, { id, enabled: true, shapeIds: shapes, tool });
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
export function setOperationTool(store: DocumentStore, id: string, tool: Tool): ActionResult {
  const operation = store.getState().document.operations.find((candidate) => candidate.id === id);
  if (!operation) return OK;
  // E.g. a V-bit for a drill operation.
  const parsed = Operation.safeParse({ ...operation, tool });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  changeOperation(store, "setOperationTool", id, (draft) => {
    draft.tool = tool;
  });
  return OK;
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
  return updateParams(store, id, "profile", ProfileParams, "updateProfileParams", changes);
}

/** Changes some of a pocket's params at once, like `updateProfileParams`. */
export function updatePocketParams(
  store: DocumentStore,
  id: string,
  changes: Partial<PocketParams>,
): ActionResult {
  return updateParams(store, id, "pocket", PocketParams, "updatePocketParams", changes);
}

/** Changes some of a drill operation's params at once, like `updateProfileParams`. */
export function updateDrillParams(
  store: DocumentStore,
  id: string,
  changes: Partial<DrillParams>,
): ActionResult {
  return updateParams(store, id, "drill", DrillParams, "updateDrillParams", changes);
}

type ParamsOf<T extends Operation["type"]> = Extract<Operation, { type: T }>["params"];

function updateParams<T extends Operation["type"]>(
  store: DocumentStore,
  id: string,
  type: T,
  schema: z.ZodType<ParamsOf<T>>,
  name: string,
  changes: Partial<ParamsOf<T>>,
): ActionResult {
  const operation = store.getState().document.operations.find((candidate) => candidate.id === id);
  if (operation?.type !== type) return { ok: false, error: `Not a ${type} operation` };
  const parsed = schema.safeParse({ ...operation.params, ...changes });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  changeOperation(store, name, id, (draft) => {
    // Field by field, so unchanged values record no patches.
    if (draft.type === type) Object.assign(draft.params, changes);
  });
  return OK;
}

/** Tabs per contour when they're turned on. */
export const DEFAULT_TAB_COUNT = 4;

/** The operation's shapes, in its order. */
function operationShapes(document: ProjectDocument, operation: Operation): Shape[] {
  const shapes = new Map(document.geometry.map((shape) => [shape.id, shape]));
  return operation.shapeIds.flatMap((id) => shapes.get(id) ?? []);
}

/**
 * Tabs a profile starts with: 6 mm wide, 3 mm tall but no more than half the
 * depth, `DEFAULT_TAB_COUNT` on each contour.
 */
export function defaultTabs(document: ProjectDocument, operation: ProfileOperation): ProfileTabs {
  return {
    width: 6,
    height: Math.min(3, operation.params.depth / 2),
    positions: autoTabPositions(operationShapes(document, operation), operation.params.side, {
      count: DEFAULT_TAB_COUNT,
    }),
  };
}

/** The profile `id`'s tabs, if it is a profile with tabs. */
function profileTabs(store: DocumentStore, id: string): ProfileTabs | null {
  const operation = store.getState().document.operations.find((candidate) => candidate.id === id);
  return operation?.type === "profile" ? operation.params.tabs : null;
}

/** Applies `recipe` to the tab positions of the profile `id`, if it has tabs. */
function changeTabPositions(
  store: DocumentStore,
  name: string,
  id: string,
  recipe: (positions: Point[]) => void,
) {
  changeOperation(store, name, id, (operation) => {
    if (operation.type === "profile" && operation.params.tabs) {
      recipe(operation.params.tabs.positions);
    }
  });
}

/** Replaces the profile's tab positions with ones spread along its contours by `placement`. */
export function autoPlaceTabs(
  store: DocumentStore,
  id: string,
  placement: TabPlacement,
): ActionResult {
  const { document } = store.getState();
  const operation = document.operations.find((candidate) => candidate.id === id);
  if (operation?.type !== "profile" || !operation.params.tabs) {
    return { ok: false, error: "The profile has no tabs" };
  }
  const positions = autoTabPositions(
    operationShapes(document, operation),
    operation.params.side,
    placement,
  );
  changeTabPositions(store, "autoPlaceTabs", id, (draft) => {
    draft.splice(0, draft.length, ...positions);
  });
  return OK;
}

export function addTab(store: DocumentStore, id: string, position: Point) {
  if (!profileTabs(store, id)) return;
  changeTabPositions(store, "addTab", id, (positions) => {
    positions.push(position);
  });
}

export function moveTab(store: DocumentStore, id: string, index: number, position: Point) {
  const tabs = profileTabs(store, id);
  if (!tabs || index < 0 || index >= tabs.positions.length) return;
  changeTabPositions(store, "moveTab", id, (positions) => {
    positions[index] = position;
  });
}

export function removeTab(store: DocumentStore, id: string, index: number) {
  changeTabPositions(store, "removeTab", id, (positions) => {
    if (index >= 0 && index < positions.length) positions.splice(index, 1);
  });
}
