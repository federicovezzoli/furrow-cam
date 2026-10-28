import {
  clearingTool,
  DEFAULT_ENTRY_CLEARANCE,
  type Model,
  type Operation,
  type OperationTarget,
  operationModelId,
  type ProjectDocument,
  type Shape,
  type TouchOffDisc,
  toolProblem,
} from "@furrow/document";
import type { Rect } from "../geometry/bounds";
import { drillTargets, type Flip, flipOperation, flipShapes } from "../scene/sides";
import { activeTouchOff } from "../scene/touch-off";
import { cutterProfile, type SimulationCut } from "../simulation/simulation";
import { drillToolpath } from "./drill";
import { engraveToolpath } from "./engrave";
import type { ToolpathMessage } from "./messages";
import { pocketToolpath } from "./pocket/pocket";
import { profileToolpath } from "./profile";
import {
  type Cache,
  createCache,
  type ReliefCache,
  type RestOptions,
  runSteps,
} from "./relief/finish";
import { reliefFinishSteps } from "./relief/finishing";
import { reliefRoughSteps } from "./relief/rough";
import type { Toolpath, ToolpathMove } from "./toolpath";
import { vcarveToolpath } from "./vcarve";

/** Retract height above the stock top when the project has no machine profile. */
export const DEFAULT_SAFE_Z = 5;

/** Everything a toolpath depends on, small enough to post to a worker. */
export type ToolpathInput = {
  operation: Operation;
  /** The operation's shapes, in its order, with only the paths it targets. */
  shapes: Shape[];
  /** The model a 3D operation machines (PRD-0005), `null` for the others. */
  model: Model | null;
  /**
   * The stock seen from above, for 3D roughing and outside pockets up to its
   * edges, for rest machining and for checking locating pins are on it;
   * `null` for the others.
   */
  stock: Rect | null;
  /** The stock's bottom, below which 3D operations don't cut; `null` for the others. */
  stockBottom: number | null;
  /**
   * In a two-sided project, the parting plane in this side's stock
   * coordinates, below which its 3D operations don't cut (ADR-0060); `null`
   * otherwise.
   */
  parting: number | null;
  /**
   * On the bottom side, the flip to its stock coordinates, applied to the
   * shapes or the model before the toolpath is computed; `null` on the top.
   */
  flip: Flip | null;
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts. */
  entryClearance: number;
  /**
   * For rest machining (#118), the inputs of the enabled operations cut
   * before this one, in order; empty for every other operation.
   */
  before: ToolpathInput[];
  /**
   * The touch-off pad (#147, `activeTouchOff`): 3D operations leave it
   * uncut, 2D ones warn when they reach it. `null` for none.
   */
  touchOff: TouchOffDisc | null;
};

/** Whether `operation` only cuts the material the operations before it left (PRD-0005 S8). */
export function isRestMachining(operation: Operation): boolean {
  return (
    (operation.type === "relief_finish" || operation.type === "relief_rough") &&
    operation.params.rest
  );
}

/** Collects the inputs of `operationId` from the document. */
export function toolpathInput(doc: ProjectDocument, operationId: string): ToolpathInput {
  const operation = doc.operations.find((op) => op.id === operationId);
  if (!operation) throw new Error(`Unknown operation ${operationId}`);
  return toolpathInputs(doc, [operation])[0] as ToolpathInput;
}

/** Collects the inputs of each of `operations` (by default all of them), in their order. */
export function toolpathInputs(
  doc: ProjectDocument,
  operations: readonly Operation[] = doc.operations,
): ToolpathInput[] {
  const shapes = new Map(doc.geometry.map((shape) => [shape.id, shape]));
  const models = new Map(doc.models.map((model) => [model.id, model]));
  const safeZ = doc.machine?.safeZ ?? DEFAULT_SAFE_Z;
  const entryClearance = doc.machine?.entryClearance ?? DEFAULT_ENTRY_CLEARANCE;
  const stock: Rect = { min: [0, 0], max: [doc.stock.width, doc.stock.height] };
  const pad = activeTouchOff(doc.stock);
  // The disc alone, so editing the pad's tool change recomputes nothing.
  const touchOff: TouchOffDisc | null = pad && { x: pad.x, y: pad.y, diameter: pad.diameter };
  const enabled = doc.operations.filter((operation) => operation.enabled);
  const { twoSided, width, height, thickness } = doc.stock;
  const size = { width, height, thickness };
  const inputs = new Map<Operation, ToolpathInput>();
  function inputOf(operation: Operation): ToolpathInput {
    const known = inputs.get(operation);
    if (known) return known;
    const rest = isRestMachining(operation);
    const index = doc.operations.indexOf(operation);
    const sided = twoSided && operationModelId(operation) !== null ? twoSided : null;
    const bottom = operation.stockSide === "bottom";
    const flip: Flip | null = twoSided && bottom ? { ...size, axis: twoSided.flipAxis } : null;
    const targeted = targetedShapes(shapes, operation.targets);
    const input: ToolpathInput = {
      ...(operation.type === "drill"
        ? drillTargets(operation, targeted, doc.stock)
        : { operation, shapes: targeted }),
      model: models.get(operationModelId(operation) ?? "") ?? null,
      // Only these depend on the stock, so resizing it recomputes nothing else.
      stock:
        rest ||
        (operation.type === "relief_rough" && operation.params.boundary.type !== "model") ||
        (operation.type === "drill" && operation.params.pins) ||
        (operation.type === "pocket" && operation.params.side === "outside")
          ? stock
          : null,
      stockBottom: operationModelId(operation) === null ? null : -doc.stock.thickness,
      parting: sided && (bottom ? sided.partingDepth - doc.stock.thickness : -sided.partingDepth),
      flip,
      safeZ,
      entryClearance,
      // Each side starts from uncut stock (ADR-0060).
      before: rest
        ? enabled
            .filter(
              (other) =>
                doc.operations.indexOf(other) < index && other.stockSide === operation.stockSide,
            )
            .map(inputOf)
        : [],
      touchOff,
    };
    inputs.set(operation, input);
    return input;
  }
  return operations.map(inputOf);
}

/**
 * The shapes `targets` refer to, in their order, each with only its targeted
 * paths (ADR-0018). Targets of shapes not in `shapes` and indices past a
 * shape's paths are skipped.
 */
export function targetedShapes(
  shapes: ReadonlyMap<string, Shape>,
  targets: readonly OperationTarget[],
): Shape[] {
  return targets.flatMap(({ shapeId, paths }) => {
    const shape = shapes.get(shapeId);
    if (!shape) return [];
    if (paths === null) return [shape];
    const kept = paths.flatMap((index) => shape.paths[index] ?? []);
    return kept.length > 0 ? [{ ...shape, paths: kept }] : [];
  });
}

/**
 * A string that changes exactly when the toolpath of `input` may change:
 * names, colours, notes and the enabled flag are left out, so renaming an
 * operation, its tool or its shapes never recomputes it. A rest operation's
 * key holds those of the operations before it, without their own `before`:
 * that is a part of its own, so nesting it would grow the key exponentially
 * with chained rest operations.
 */
export function toolpathKey(input: ToolpathInput): string {
  return JSON.stringify([...ownKey(input), input.before.map(ownKey)]);
}

/** What `toolpathKey` holds of `input` itself. */
function ownKey({
  operation,
  shapes,
  model,
  stock,
  stockBottom,
  parting,
  flip,
  safeZ,
  entryClearance,
  touchOff,
}: ToolpathInput): unknown[] {
  const { name: _name, color: _color, notes: _notes, ...tool } = operation.tool;
  return [
    operation.type,
    operation.params,
    tool,
    shapes.map((shape) => shape.paths),
    model && [model.sha256, model.bounds, model.placement],
    stock,
    stockBottom,
    parting,
    flip,
    safeZ,
    entryClearance,
    touchOff,
  ];
}

/** What toolpaths of 3D operations need besides their input. */
export type ToolpathContext = {
  /** The triangles of the mesh with this hash (`StlMesh.positions`), if loaded. */
  mesh?: (sha256: string) => Float32Array | undefined;
  /** Model heightmaps kept between toolpaths. */
  cache?: ReliefCache;
  /**
   * The moves of toolpaths computed before, by `toolpathKey`, so a rest
   * operation doesn't compute the operations before it again.
   */
  cuts?: Cache<SimulationCut[]>;
};

/**
 * The hashes of the meshes computing `input` may need: its own model's and,
 * for rest machining, those of the operations before it (whose own `before`
 * are among them).
 */
export function toolpathMeshes({ model, before }: ToolpathInput): Set<string> {
  const meshes = new Set<string>();
  for (const input of [...before, { model }]) if (input.model) meshes.add(input.model.sha256);
  return meshes;
}

/** Thrown when a 3D operation's mesh isn't in the `ToolpathContext`. */
export class MissingMeshError extends Error {
  override name = "MissingMeshError";

  constructor(readonly sha256: string) {
    super("The model's mesh isn't loaded");
  }
}

/**
 * The moves of `toolpath` as simulation cuts, its clearing tool's first:
 * every move after the first (which has no start), rapids included.
 */
export function toolpathCuts(operation: Operation, toolpath: Toolpath): SimulationCut[] {
  const segments = (moves: readonly ToolpathMove[]) => {
    const values = new Float32Array(Math.max(0, moves.length - 1) * 6);
    for (let i = 1; i < moves.length; i++) {
      values.set((moves[i - 1] as ToolpathMove).to, (i - 1) * 6);
      values.set((moves[i] as ToolpathMove).to, (i - 1) * 6 + 3);
    }
    return values;
  };
  const cuts: SimulationCut[] = [];
  const clearing = clearingTool(operation);
  if (clearing && toolpath.clearing) {
    cuts.push({ tool: clearing, segments: segments(toolpath.clearing) });
  }
  cuts.push({ tool: operation.tool, segments: segments(toolpath.moves) });
  return cuts;
}

/** Share of a rest operation's progress the toolpaths before it take, when computed. */
const BEFORE_SHARE = 0.3;

/**
 * Computes an operation's toolpath, yielding the fraction done as it goes
 * (3D operations only; the others yield nothing), so a Web Worker can report
 * progress and stop between steps (ADR-0004). Its moves are kept in the
 * context's `cuts` for the rest operations after it.
 */
export function* toolpathSteps(
  input: ToolpathInput,
  context: ToolpathContext = {},
): Generator<number, Toolpath> {
  const toolpath = yield* operationSteps(input, context);
  context.cuts?.set(toolpathKey(input), toolpathCuts(input.operation, toolpath));
  return toolpath;
}

/**
 * What the operations before a rest operation cut, each from the context's
 * `cuts` or computed, yielding the fraction done. An operation whose
 * toolpath fails cuts nothing, as in the simulation (ADR-0019), and says so
 * in `warnings`.
 */
function* restCuts(
  before: readonly ToolpathInput[],
  context: ToolpathContext,
  warnings: ToolpathMessage[],
): Generator<number, SimulationCut[]> {
  const cuts: SimulationCut[] = [];
  for (const [i, input] of before.entries()) {
    const cached = context.cuts?.get(toolpathKey(input));
    if (cached) {
      cuts.push(...cached);
      continue;
    }
    const steps = toolpathSteps(input, context);
    try {
      for (let step = steps.next(); ; step = steps.next()) {
        if (step.done) {
          cuts.push(...toolpathCuts(input.operation, step.value));
          break;
        }
        yield (i + step.value) / before.length;
      }
    } catch (error) {
      if (error instanceof MissingMeshError) throw error;
      warnings.push({
        code: "toolpath.restOperationFailed",
        values: { operation: input.operation.name },
      });
    }
  }
  return cuts;
}

/** Said when a 2D operation cuts into the touch-off pad. */
export const TOUCH_OFF_WARNING: ToolpathMessage = { code: "toolpath.touchOffPad" };

/**
 * Whether any cut of `operation`'s toolpath, below the stock top, reaches
 * into `pad`: the tool's reach at the cut's depth comes within the pad.
 */
export function cutsTouchOff(operation: Operation, toolpath: Toolpath, pad: TouchOffDisc): boolean {
  const r = pad.diameter / 2;
  return toolpathCuts(operation, toolpath).some(({ tool, segments }) => {
    const profile = cutterProfile(tool);
    for (let i = 0; i + 5 < segments.length; i += 6) {
      const [ax, ay, az, bx, by, bz] = segments.subarray(i, i + 6) as unknown as number[];
      const depth = -Math.min(az as number, bz as number);
      if (!(depth > 1e-6)) continue;
      const reach = Math.min(profile.radius, profile.reach(depth));
      if (
        segmentDistance(pad.x, pad.y, ax as number, ay as number, bx as number, by as number) <
        r + reach
      ) {
        return true;
      }
    }
    return false;
  });
}

/** The distance from `(px, py)` to the segment from `(ax, ay)` to `(bx, by)`. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** A 2D toolpath, warning when it cuts into the touch-off pad rather than avoiding it (ADR-0041). */
function checkTouchOff(
  operation: Operation,
  toolpath: Toolpath,
  pad: TouchOffDisc | null,
): Toolpath {
  if (!pad || !cutsTouchOff(operation, toolpath, pad)) return toolpath;
  return { ...toolpath, warnings: [...toolpath.warnings, TOUCH_OFF_WARNING] };
}

/** A pin drill's toolpath (#356), warning when a pin hole reaches past the stock's edges. */
function checkPinsOnStock(
  operation: Operation,
  shapes: Shape[],
  stock: Rect | null,
  toolpath: Toolpath,
): Toolpath {
  if (operation.type !== "drill" || !operation.params.pins || !stock) return toolpath;
  const tolerance = 1e-9;
  const off = shapes.some(({ paths }) =>
    paths.some(({ start: [x, y], segments }) => {
      // Each pin is a circle from its rightmost point around its centre.
      const [cx, cy] = segments[0]?.kind === "arc" ? segments[0].center : [x, y];
      const r = x - cx;
      return (
        cx - r < stock.min[0] - tolerance ||
        cx + r > stock.max[0] + tolerance ||
        cy - r < stock.min[1] - tolerance ||
        cy + r > stock.max[1] + tolerance
      );
    }),
  );
  if (!off) return toolpath;
  return { ...toolpath, warnings: [...toolpath.warnings, { code: "toolpath.pinsOffStock" }] };
}

function* operationSteps(
  {
    operation,
    shapes,
    model,
    stock,
    stockBottom,
    parting,
    flip,
    before,
    touchOff,
    ...options
  }: ToolpathInput,
  context: ToolpathContext,
): Generator<number, Toolpath> {
  const { mesh, cache } = context;
  // E.g. a drill bit on a profile saved before the tool picker refused it.
  const problem = toolProblem(operation);
  if (problem) return { moves: [], warnings: [problem] };
  if (flip && operationModelId(operation) === null) {
    // The drawing seen from below (ADR-0060); 3D operations flip their model.
    shapes = flipShapes(shapes, flip);
    operation = flipOperation(operation, flip);
  }
  switch (operation.type) {
    case "profile":
      return checkTouchOff(operation, profileToolpath(operation, shapes, options), touchOff);
    case "pocket":
      return checkTouchOff(operation, pocketToolpath(operation, shapes, options, stock), touchOff);
    case "drill":
      if (operation.params.pins && shapes.length === 0) {
        return { moves: [], warnings: [{ code: "toolpath.noLocatingPins" }] };
      }
      return checkPinsOnStock(
        operation,
        shapes,
        stock,
        checkTouchOff(operation, drillToolpath(operation, shapes, options), touchOff),
      );
    case "engrave":
      return checkTouchOff(operation, engraveToolpath(operation, shapes, options), touchOff);
    case "vcarve":
      return checkTouchOff(operation, vcarveToolpath(operation, shapes, options), touchOff);
    case "relief_finish":
    case "relief_rough": {
      if (!model) return { moves: [], warnings: [{ code: "toolpath.modelMissing" }] };
      const positions = mesh?.(model.sha256);
      if (!positions) throw new MissingMeshError(model.sha256);
      const warnings: ToolpathMessage[] = [];
      let rest: RestOptions | null = null;
      let share = 0;
      if (operation.params.rest) {
        // Without a cache, an earlier rest operation would compute the ones
        // before it again, and so on down the chain.
        const restContext = context.cuts
          ? context
          : { ...context, cuts: createCache<SimulationCut[]>(before.length + 1) };
        const cuts = restCuts(before, restContext, warnings);
        for (let step = cuts.next(); ; step = cuts.next()) {
          if (step.done) {
            rest = { cuts: step.value, stock };
            break;
          }
          share = BEFORE_SHARE;
          yield BEFORE_SHARE * step.value;
        }
      }
      const steps =
        operation.type === "relief_finish"
          ? reliefFinishSteps(operation, model, positions, {
              ...options,
              stockBottom,
              parting,
              flip,
              cache,
              rest,
              touchOff,
            })
          : reliefRoughSteps(operation, model, positions, {
              ...options,
              stock,
              stockBottom,
              parting,
              flip,
              cache,
              rest,
              touchOff,
            });
      for (let step = steps.next(); ; step = steps.next()) {
        if (step.done) {
          return { ...step.value, warnings: [...warnings, ...step.value.warnings] };
        }
        yield share + (1 - share) * step.value;
      }
    }
  }
}

/** Computes an operation's toolpath. Runs in a Web Worker (ADR-0004). */
export function generateToolpath(input: ToolpathInput, context?: ToolpathContext): Toolpath {
  return runSteps(toolpathSteps(input, context));
}
