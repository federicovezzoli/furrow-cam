import {
  autoTabPositions,
  type TabPlacement,
  targetedShapes,
  vBitConeDepth,
} from "@furrow/cam-core";
import {
  canDrill,
  canEngrave,
  canVCarve,
  DrillParams,
  EngraveParams,
  Name,
  normalizeTargets,
  Operation,
  type OperationTarget,
  PocketParams,
  type Point,
  type ProfileOperation,
  ProfileParams,
  type ProfileTabs,
  type ProjectDocument,
  ReliefFinishParams,
  ReliefRoughParams,
  type Shape,
  type Tool,
  VCarveParams,
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
 * New pockets go half through the stock with offset clearing, climb milling,
 * ramping in: an end mill plunging straight into the middle of a pocket has
 * nowhere to clear its chips.
 */
export function defaultPocketParams(document: ProjectDocument): PocketParams {
  return {
    strategy: { type: "offset" },
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

/** How deep new engravings go, unless the stock is thinner. */
export const DEFAULT_ENGRAVE_DEPTH = 1;

/**
 * New engravings follow the paths on the line, `DEFAULT_ENGRAVE_DEPTH` deep,
 * plunging: a shallow cut needs no ramp.
 */
export function defaultEngraveParams(document: ProjectDocument): EngraveParams {
  return {
    side: "on",
    depth: Math.min(DEFAULT_ENGRAVE_DEPTH, document.stock.thickness),
    ramp: false,
  };
}

/**
 * New V-carves go as deep as the bit's cone, but no deeper than half the
 * stock, without a flat bottom.
 */
export function defaultVCarveParams(document: ProjectDocument, tool: Tool): VCarveParams {
  const half = document.stock.thickness / 2;
  return { maxDepth: Math.min(vBitConeDepth(tool) ?? half, half), flatBottom: null };
}

/** Step-over of new 3D finishing operations, as a percentage of the tool's diameter. */
export const DEFAULT_RELIEF_STEP_OVER = 10;

/**
 * New 3D finishing operations on `modelId` run zig-zag along X at a 10%
 * step-over (PRD-0005), leaving no stock and cutting everything (no rest
 * machining).
 */
export function defaultReliefFinishParams(modelId: string): ReliefFinishParams {
  return {
    modelId,
    angle: 0,
    stepOver: DEFAULT_RELIEF_STEP_OVER,
    direction: "zigzag",
    stockToLeave: 0,
    rest: false,
  };
}

/**
 * New 3D roughing operations on `modelId` clear the model's outline with
 * offset clearing at the tool's step-over, climb milling and ramping in,
 * leaving 0.5 mm of stock for finishing (PRD-0005), and cutting everything
 * (no rest machining).
 */
export function defaultReliefRoughParams(modelId: string): ReliefRoughParams {
  return {
    modelId,
    strategy: { type: "offset" },
    direction: "climb",
    stepOver: null,
    stockToLeave: 0.5,
    boundary: "model",
    ramp: true,
    rest: false,
  };
}

/** `Profile 1`, `Profile 2`, …: the first number no operation's name uses. */
function nextName(document: ProjectDocument, base: string): string {
  const names = new Set(document.operations.map((operation) => operation.name));
  let n = 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Appends a profile of `targets` (shapes and paths no longer in the document
 * are skipped) cut with a snapshot of `tool`. Returns the new operation's id,
 * or `null` if none of the targets exist.
 */
export function addProfileOperation(store: DocumentStore, options: NewOperation): string | null {
  return appendOperation(store, options, (document, fields) => ({
    ...fields,
    type: "profile",
    name: nextName(document, "Profile"),
    params: defaultProfileParams(document),
  }));
}

/** Appends a pocket of `targets`, like `addProfileOperation`. */
export function addPocketOperation(store: DocumentStore, options: NewOperation): string | null {
  return appendOperation(store, options, (document, fields) => ({
    ...fields,
    type: "pocket",
    name: nextName(document, "Pocket"),
    params: defaultPocketParams(document),
  }));
}

/**
 * Appends a drill operation on `targets`, like `addProfileOperation`.
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

/**
 * Appends an engrave operation on `targets`, like `addProfileOperation`.
 * Returns `null` as well if `tool` can't engrave.
 */
export function addEngraveOperation(store: DocumentStore, options: NewOperation): string | null {
  if (!canEngrave(options.tool)) return null;
  return appendOperation(store, options, (document, fields) => ({
    ...fields,
    type: "engrave",
    name: nextName(document, "Engrave"),
    params: defaultEngraveParams(document),
  }));
}

/**
 * Appends a V-carve of `targets`, like `addProfileOperation`. Returns `null`
 * as well if `tool` isn't a V-bit.
 */
export function addVCarveOperation(store: DocumentStore, options: NewOperation): string | null {
  if (!canVCarve(options.tool)) return null;
  return appendOperation(store, options, (document, fields) => ({
    ...fields,
    type: "vcarve",
    name: nextName(document, "V-carve"),
    params: defaultVCarveParams(document, options.tool),
  }));
}

/**
 * Appends a 3D finishing operation on the model `modelId` cut with a snapshot
 * of `tool`. Returns the new operation's id, or `null` if the model isn't in
 * the document.
 */
export function addReliefFinishOperation(store: DocumentStore, options: NewModelOperation) {
  return appendModelOperation(store, options, (document, fields) => ({
    ...fields,
    type: "relief_finish",
    name: nextName(document, "3D finish"),
    params: defaultReliefFinishParams(options.modelId),
  }));
}

/** Appends a 3D roughing operation on the model `modelId`, like `addReliefFinishOperation`. */
export function addReliefRoughOperation(store: DocumentStore, options: NewModelOperation) {
  return appendModelOperation(store, options, (document, fields) => ({
    ...fields,
    type: "relief_rough",
    name: nextName(document, "3D rough"),
    params: defaultReliefRoughParams(options.modelId),
  }));
}

type NewModelOperation = { modelId: string; tool: Tool; id?: string };

function appendModelOperation(
  store: DocumentStore,
  { modelId, tool, id = crypto.randomUUID() }: NewModelOperation,
  create: (document: ProjectDocument, fields: OperationFields) => Operation,
): string | null {
  const { document } = store.getState();
  if (!document.models.some((model) => model.id === modelId)) return null;
  const operation = create(document, { id, enabled: true, targets: [], tool });
  store.getState().change("addOperation", (draft) => {
    draft.operations.push(operation);
  });
  return id;
}

type NewOperation = { targets: OperationTarget[]; tool: Tool; id?: string };

type OperationFields = Pick<Operation, "id" | "enabled" | "targets" | "tool">;

function appendOperation(
  store: DocumentStore,
  { targets, tool, id = crypto.randomUUID() }: NewOperation,
  create: (document: ProjectDocument, fields: OperationFields) => Operation,
): string | null {
  const { document } = store.getState();
  const existing = normalizeTargets(document.geometry, targets);
  if (existing.length === 0) return null;
  const operation = create(document, { id, enabled: true, targets: existing, tool });
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

/**
 * Equal for tool snapshots with the same settings. Snapshots are parsed by
 * `Tool`, so their keys come in the same order.
 */
export function toolKey(tool: Tool): string {
  return JSON.stringify(tool);
}

/** An operation left with its old tool by `replaceToolSnapshots`, and why. */
export type RejectedOperation = { id: string; name: string; error: string };

/**
 * Gives every operation whose tool snapshot is `previous` the snapshot `next`
 * instead, as one undo step (e.g. after the library bit was edited), its
 * flat-bottom tool as well as its own. Operations that can't take `next`,
 * such as a drill operation given a V-bit, keep their tools and are returned.
 */
export function replaceToolSnapshots(
  store: DocumentStore,
  previous: Tool,
  next: Tool,
): RejectedOperation[] {
  const key = toolKey(previous);
  if (key === toolKey(next)) return [];
  const rejected: RejectedOperation[] = [];
  const accepted = new Set<string>();
  const replace = (operation: Operation) => {
    if (toolKey(operation.tool) === key) operation.tool = next;
    if (operation.type === "vcarve" && operation.params.flatBottom) {
      const { flatBottom } = operation.params;
      if (toolKey(flatBottom.tool) === key) flatBottom.tool = next;
    }
  };
  for (const operation of store.getState().document.operations) {
    const flatBottom = operation.type === "vcarve" ? operation.params.flatBottom : null;
    const uses =
      toolKey(operation.tool) === key || (flatBottom && toolKey(flatBottom.tool) === key);
    if (!uses) continue;
    const candidate = structuredClone(operation);
    replace(candidate);
    const parsed = Operation.safeParse(candidate);
    if (parsed.success) accepted.add(operation.id);
    else rejected.push({ id: operation.id, name: operation.name, error: firstError(parsed.error) });
  }
  if (accepted.size > 0) {
    store.getState().change("replaceToolSnapshots", (draft) => {
      for (const operation of draft.operations) {
        if (accepted.has(operation.id)) replace(operation);
      }
    });
  }
  return rejected;
}

/** Sets what the operation cuts; shapes and paths no longer in the document are skipped. */
export function setOperationTargets(
  store: DocumentStore,
  id: string,
  targets: OperationTarget[],
): ActionResult {
  const existing = normalizeTargets(store.getState().document.geometry, targets);
  if (existing.length === 0) return { ok: false, error: "An operation needs at least one shape" };
  changeOperation(store, "setOperationTargets", id, (operation) => {
    operation.targets = existing;
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

/** Changes some of a V-carve's params at once, like `updateProfileParams`. */
export function updateVCarveParams(
  store: DocumentStore,
  id: string,
  changes: Partial<VCarveParams>,
): ActionResult {
  return updateParams(store, id, "vcarve", VCarveParams, "updateVCarveParams", changes);
}

/** Changes some of a 3D finishing operation's params at once, like `updateProfileParams`. */
export function updateReliefFinishParams(
  store: DocumentStore,
  id: string,
  changes: Partial<Omit<ReliefFinishParams, "modelId">>,
): ActionResult {
  return updateParams(
    store,
    id,
    "relief_finish",
    ReliefFinishParams,
    "updateReliefFinishParams",
    changes,
  );
}

/** Changes some of a 3D roughing operation's params at once, like `updateProfileParams`. */
export function updateReliefRoughParams(
  store: DocumentStore,
  id: string,
  changes: Partial<Omit<ReliefRoughParams, "modelId">>,
): ActionResult {
  return updateParams(
    store,
    id,
    "relief_rough",
    ReliefRoughParams,
    "updateReliefRoughParams",
    changes,
  );
}

/** Changes some of an engrave operation's params at once, like `updateProfileParams`. */
export function updateEngraveParams(
  store: DocumentStore,
  id: string,
  changes: Partial<EngraveParams>,
): ActionResult {
  return updateParams(store, id, "engrave", EngraveParams, "updateEngraveParams", changes);
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

/** The operation's shapes, in its order, with only the paths it targets. */
function operationShapes(document: ProjectDocument, operation: Operation): Shape[] {
  const shapes = new Map(document.geometry.map((shape) => [shape.id, shape]));
  return targetedShapes(shapes, operation.targets);
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
