import { randomUUID } from "node:crypto";
import {
  DrillParams,
  EngraveParams,
  normalizeTargets,
  type Operation,
  type OperationTarget,
  PocketParams,
  Point,
  ProfileParams,
  type ProjectDocument,
  ReliefFinishParams,
  ReliefRoughParams,
  type StockSide,
  stockPins,
  type Tool,
  VCarveParams,
} from "@furrow/document";
import { formatMessage, type Translatable } from "@furrow/ui/lib/i18n";
import type { DocumentStore } from "@furrow/workspace/stores/document-store";
import {
  type ActionResult,
  addDrillOperation,
  addEngraveOperation,
  addPocketOperation,
  addProfileOperation,
  addReliefFinishOperation,
  addReliefRoughOperation,
  addVCarveOperation,
  autoPlaceTabs,
  DEFAULT_STEP_OVER,
  defaultDrillParams,
  defaultEngraveParams,
  defaultPocketParams,
  defaultProfileParams,
  defaultReliefFinishParams,
  defaultReliefRoughParams,
  defaultTabs,
  defaultVCarveParams,
  deleteOperation,
  moveOperation,
  renameOperation,
  setDrillPins,
  setOperationEnabled,
  setOperationTargets,
  toolError,
  updateDrillParams,
  updateEngraveParams,
  updatePocketParams,
  updateProfileParams,
  updateReliefFinishParams,
  updateReliefRoughParams,
  updateVCarveParams,
} from "@furrow/workspace/stores/operation-actions";
import { z } from "zod";
import type { Library } from "./library";
import { change, type Project, ToolError, t } from "./projects";
import { resolveTool, type ToolChoice } from "./setup";

/** The app's message for the assistant. */
const text = (message: Translatable) => formatMessage(t, message);

export type OperationType = Operation["type"];

/** Operations on the drawings' shapes; the others machine a 3D model. */
type ShapeType = Exclude<OperationType, "relief_rough" | "relief_finish">;
type ModelType = Extract<OperationType, "relief_rough" | "relief_finish">;

const isModelType = (type: OperationType): type is ModelType =>
  type === "relief_rough" || type === "relief_finish";

const ADD_ON_SHAPES = {
  profile: addProfileOperation,
  pocket: addPocketOperation,
  drill: addDrillOperation,
  engrave: addEngraveOperation,
  vcarve: addVCarveOperation,
} satisfies Record<ShapeType, unknown>;

const ADD_ON_MODEL = {
  relief_rough: addReliefRoughOperation,
  relief_finish: addReliefFinishOperation,
} satisfies Record<ModelType, unknown>;

/** The params a new operation of `type` starts with, as its `add*Operation` gives it. */
const DEFAULT_PARAMS: Record<
  OperationType,
  (document: ProjectDocument, tool: Tool, modelId: string) => Operation["params"]
> = {
  profile: defaultProfileParams,
  pocket: defaultPocketParams,
  drill: defaultDrillParams,
  engrave: defaultEngraveParams,
  vcarve: defaultVCarveParams,
  relief_rough: (_, __, modelId) => defaultReliefRoughParams(modelId),
  relief_finish: (_, __, modelId) => defaultReliefFinishParams(modelId),
};

// `never`: each takes its own type's params, which `configure` leaves the schema to check.
const UPDATE: Record<
  OperationType,
  (store: DocumentStore, id: string, changes: never) => ActionResult
> = {
  profile: updateProfileParams,
  pocket: updatePocketParams,
  drill: updateDrillParams,
  engrave: updateEngraveParams,
  vcarve: updateVCarveParams,
  relief_rough: updateReliefRoughParams,
  relief_finish: updateReliefFinishParams,
};

/** The settings each type has: its params' names, but the model a 3D operation machines. */
const SETTINGS: Record<OperationType, string[]> = Object.fromEntries(
  Object.entries({
    profile: ProfileParams,
    pocket: PocketParams,
    drill: DrillParams,
    engrave: EngraveParams,
    vcarve: VCarveParams,
    relief_rough: ReliefRoughParams,
    relief_finish: ReliefFinishParams,
  }).map(([type, schema]) => [type, Object.keys(schema.shape).filter((key) => key !== "modelId")]),
) as Record<OperationType, string[]>;

/** A whole drawing, or a shape with all its paths or only some, by index. */
export type TargetInput = { drawingId: string } | { shapeId: string; paths?: number[] };

/** Holding tabs as an assistant gives them: spread by count or spacing, or at positions. */
const TabsInput = z
  .strictObject({
    width: z.number().optional(),
    height: z.number().optional(),
    count: z.int().positive().optional(),
    spacing: z.number().positive().optional(),
    positions: z.array(Point).optional(),
  })
  .nullable();

/** A V-carve's flat bottom as an assistant gives it: its end mill and step-over. */
const FlatBottomInput = z
  .strictObject({
    toolId: z.string().optional(),
    tool: z.record(z.string(), z.unknown()).optional(),
    stepOver: z.number().optional(),
  })
  .nullable();

/** `input` parsed by `schema`; throws a `ToolError` naming `what` if it doesn't fit. */
function parse<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  const where = [what, ...(issue?.path ?? [])].join(".");
  throw new ToolError(`${where}: ${issue?.message ?? "invalid"}`);
}

/** Throws a `ToolError` with `result`'s message if the action was refused. */
function check(result: ActionResult) {
  if (!result.ok) throw new ToolError(text(result.error));
}

function findOperation(document: ProjectDocument, id: string): Operation {
  const operation = document.operations.find((candidate) => candidate.id === id);
  if (!operation) throw new ToolError(`The project has no operation ${JSON.stringify(id)}.`);
  return operation;
}

/** `inputs` as the document stores targets; throws a `ToolError` for a drawing, shape or path it hasn't. */
function targetsOf(document: ProjectDocument, inputs: TargetInput[]): OperationTarget[] {
  const targets = inputs.flatMap((input): OperationTarget[] => {
    if ("drawingId" in input) {
      if (!document.drawings.some((drawing) => drawing.id === input.drawingId)) {
        throw new ToolError(`The project has no drawing ${JSON.stringify(input.drawingId)}.`);
      }
      return document.geometry
        .filter((shape) => shape.drawingId === input.drawingId)
        .map((shape) => ({ shapeId: shape.id, paths: null }));
    }
    const shape = document.geometry.find((candidate) => candidate.id === input.shapeId);
    if (!shape) throw new ToolError(`The project has no shape ${JSON.stringify(input.shapeId)}.`);
    if (input.paths === undefined) return [{ shapeId: shape.id, paths: null }];
    const wrong = input.paths.find((index) => index >= shape.paths.length);
    if (wrong !== undefined) {
      throw new ToolError(
        `Shape ${JSON.stringify(shape.id)} has ${shape.paths.length} paths: there is no path ${wrong}.`,
      );
    }
    return [{ shapeId: shape.id, paths: [...new Set(input.paths)].sort((a, b) => a - b) }];
  });
  return normalizeTargets(document.geometry, targets);
}

/** The profile `id`'s tabs set from `input`: off, spread along its contours, or at positions. */
function setTabs(store: DocumentStore, id: string, input: unknown) {
  const tabs = parse(TabsInput, input, "tabs");
  if (tabs === null) {
    check(updateProfileParams(store, id, { tabs: null }));
    return;
  }
  const { count, spacing, positions } = tabs;
  if ([count, spacing, positions].filter((given) => given !== undefined).length > 1) {
    throw new ToolError("tabs: give count, spacing or positions, only one of them.");
  }
  const { document } = store.getState();
  const operation = findOperation(document, id);
  if (operation.type !== "profile") return;
  // As turning tabs on in the app does, then changed as asked.
  const start = operation.params.tabs ?? defaultTabs(document, operation);
  check(
    updateProfileParams(store, id, {
      tabs: {
        width: tabs.width ?? start.width,
        height: tabs.height ?? start.height,
        positions: positions ?? start.positions,
      },
    }),
  );
  const placement = count !== undefined ? { count } : spacing !== undefined ? { spacing } : null;
  if (placement) check(autoPlaceTabs(store, id, placement));
}

/** A V-carve's flat bottom from `input`, keeping its end mill and step-over unless given. */
function flatBottomOf(library: Library, operation: Operation, input: unknown) {
  const flatBottom = parse(FlatBottomInput, input, "flatBottom");
  if (flatBottom === null) return null;
  const current = operation.type === "vcarve" ? operation.params.flatBottom : null;
  const { toolId, tool: settings, stepOver } = flatBottom;
  const tool =
    toolId === undefined && settings === undefined && current
      ? current.tool
      : resolveTool(library, { toolId, settings }, "flat bottom's end mill");
  return { tool, stepOver: stepOver ?? current?.stepOver ?? DEFAULT_STEP_OVER };
}

/**
 * Changes some of operation `id`'s settings as the properties panel does:
 * its params, by the names the document gives them, with the profile's
 * `tabs`, the V-carve's `flatBottom` and the drill's `pins` given as the
 * tool descriptions say.
 */
function configure(
  store: DocumentStore,
  library: Library,
  id: string,
  settings: Record<string, unknown>,
) {
  const operation = findOperation(store.getState().document, id);
  if ("modelId" in settings) {
    throw new ToolError("modelId can't change: add an operation on the other model instead.");
  }
  // The app's message for a setting it doesn't know is only "Invalid value".
  const known = SETTINGS[operation.type];
  const unknown = Object.keys(settings).find((key) => !known.includes(key));
  if (unknown !== undefined) {
    throw new ToolError(
      `A ${operation.type} operation has no setting ${JSON.stringify(unknown)}: its settings are ${known.join(", ")}.`,
    );
  }
  const { tabs, pins, ...rest } = settings;
  let changes: Record<string, unknown> = rest;
  if (operation.type === "profile" && rest.side === "on") {
    // As in the app: on the line leaves no wall for an allowance, and no corner to overcut.
    changes = { allowance: 0, finishPass: false, cornerOvercuts: null, ...rest };
  }
  if (operation.type === "vcarve" && "flatBottom" in rest) {
    changes.flatBottom = flatBottomOf(library, operation, rest.flatBottom);
  }
  if (operation.type === "drill" && pins !== undefined && pins !== true) changes.pins = pins;

  if (Object.keys(changes).length > 0) {
    check(UPDATE[operation.type](store, id, changes as never));
  }
  if (operation.type === "drill" && pins === true) {
    // `setDrillPins` would quietly do nothing on the bottom side, and drill nothing without pins.
    if (!stockPins(store.getState().document.stock)) {
      throw new ToolError("pins: this project has no locating pins to drill.");
    }
    if (operation.stockSide !== "top") throw new ToolError(text({ code: "operation.pinsTopOnly" }));
    setDrillPins(store, id);
  }
  if (operation.type === "profile" && tabs !== undefined) setTabs(store, id, tabs);
}

/** Throws a `ToolError` with the app's message if operation `id` is no longer valid. */
function validate(store: DocumentStore, id: string) {
  const operation = findOperation(store.getState().document, id);
  const error = toolError(operation, operation.tool);
  if (error) throw new ToolError(text(error));
}

export type NewOperation = {
  /** What a 2D operation cuts. */
  targets?: TargetInput[];
  /** The model a 3D operation machines. */
  modelId?: string;
  tool: ToolChoice;
  name?: string;
  stockSide?: StockSide;
  settings?: Record<string, unknown>;
};

/**
 * Adds an operation of `type` (PRD-0012 M5) as the app's add buttons do,
 * with their defaults, then changes `settings` as the properties panel
 * does. Returns its id; refused as a whole, with the app's message, if any
 * of it is.
 */
export function addOperation(
  project: Project,
  library: Library,
  type: OperationType,
  { targets: inputs, modelId, tool: choice, name, stockSide = "top", settings }: NewOperation,
): string {
  const { document } = project.store.getState();
  if (stockSide === "bottom" && !document.stock.twoSided) {
    throw new ToolError("The project isn't two-sided: every operation cuts the top.");
  }
  const tool = resolveTool(library, choice);
  let targets: OperationTarget[] = [];
  if (isModelType(type)) {
    if (inputs !== undefined) {
      throw new ToolError("A 3D operation machines a model: give its modelId, not targets.");
    }
    if (!document.models.some((model) => model.id === modelId)) {
      throw new ToolError(
        modelId === undefined
          ? "Give the modelId of the model to machine."
          : `The project has no model ${JSON.stringify(modelId)}.`,
      );
    }
  } else {
    if (modelId !== undefined) {
      throw new ToolError("A 2D operation cuts shapes: give targets, not a modelId.");
    }
    targets = targetsOf(document, inputs ?? []);
    const holes =
      type === "drill" &&
      (settings?.pins === true || (Array.isArray(settings?.points) && settings.points.length > 0));
    if (targets.length === 0 && !holes) {
      throw new ToolError(
        type === "drill"
          ? `${text({ code: "workspace.needsShape" })}, placed holes (points) or pins: true.`
          : text({ code: "workspace.needsShape" }),
      );
    }
  }
  const id = randomUUID();
  change(project, (store) => {
    const added = isModelType(type)
      ? ADD_ON_MODEL[type](store, { modelId: modelId as string, tool, id, stockSide })
      : ADD_ON_SHAPES[type](store, { targets, tool, id, stockSide });
    if (added === null) {
      // Targets and model are checked above, so the tool is what the action refused.
      const params = DEFAULT_PARAMS[type](document, tool, modelId as string);
      const candidate = { id, type, name: type, enabled: true, stockSide, targets, tool, params };
      const error = toolError(candidate as Operation, tool);
      throw new ToolError(error ? text(error) : `This tool can't cut a ${type} operation.`);
    }
    if (name !== undefined) check(renameOperation(store, id, name));
    if (settings) configure(store, library, id, settings);
    validate(store, id);
  });
  return id;
}

export type OperationEdit = {
  name?: string;
  enabled?: boolean;
  targets?: TargetInput[];
  settings?: Record<string, unknown>;
};

/** Renames, enables or disables, retargets and changes the settings of operation `id`, all or nothing. */
export function editOperation(
  project: Project,
  library: Library,
  id: string,
  { name, enabled, targets, settings }: OperationEdit,
) {
  const operation = findOperation(project.store.getState().document, id);
  if (targets !== undefined && isModelType(operation.type)) {
    throw new ToolError("A 3D operation machines its model: it has no targets.");
  }
  change(project, (store) => {
    if (name !== undefined) check(renameOperation(store, id, name));
    if (enabled !== undefined) setOperationEnabled(store, id, enabled);
    if (targets !== undefined) {
      check(setOperationTargets(store, id, targetsOf(store.getState().document, targets)));
    }
    if (settings) configure(store, library, id, settings);
    validate(store, id);
  });
}

/** Moves operation `id` to `index` (0 is cut first) in the cutting order, clamped to the list. */
export function moveTo(project: Project, id: string, index: number) {
  findOperation(project.store.getState().document, id);
  change(project, (store) => moveOperation(store, id, index));
}

export function removeOperation(project: Project, id: string) {
  findOperation(project.store.getState().document, id);
  change(project, (store) => deleteOperation(store, id));
}
