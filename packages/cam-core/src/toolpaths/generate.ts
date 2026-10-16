import {
  clearingTool,
  DEFAULT_ENTRY_CLEARANCE,
  type Model,
  type Operation,
  type OperationTarget,
  operationModelId,
  type ProjectDocument,
  type Shape,
} from "@furrow/document";
import type { Rect } from "../geometry/bounds";
import type { SimulationCut } from "../simulation/simulation";
import { drillToolpath } from "./drill";
import { engraveToolpath } from "./engrave";
import { pocketToolpath } from "./pocket/pocket";
import { profileToolpath } from "./profile";
import {
  type Cache,
  createCache,
  type ReliefCache,
  type RestOptions,
  reliefFinishSteps,
  runSteps,
} from "./relief/finish";
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
   * The stock seen from above, for 3D roughing up to its edges and for rest
   * machining; `null` for the others.
   */
  stock: Rect | null;
  /** The stock's bottom, below which 3D operations don't cut; `null` for the others. */
  stockBottom: number | null;
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts. */
  entryClearance: number;
  /**
   * For rest machining (#118), the inputs of the enabled operations cut
   * before this one, in order; empty for every other operation.
   */
  before: ToolpathInput[];
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
  const enabled = doc.operations.filter((operation) => operation.enabled);
  const inputs = new Map<Operation, ToolpathInput>();
  function inputOf(operation: Operation): ToolpathInput {
    const known = inputs.get(operation);
    if (known) return known;
    const rest = isRestMachining(operation);
    const index = doc.operations.indexOf(operation);
    const input: ToolpathInput = {
      operation,
      shapes: targetedShapes(shapes, operation.targets),
      model: models.get(operationModelId(operation) ?? "") ?? null,
      // Only these depend on the stock, so resizing it recomputes nothing else.
      stock:
        rest || (operation.type === "relief_rough" && operation.params.boundary === "stock")
          ? stock
          : null,
      stockBottom: operationModelId(operation) === null ? null : -doc.stock.thickness,
      safeZ,
      entryClearance,
      before: rest
        ? enabled.filter((other) => doc.operations.indexOf(other) < index).map(inputOf)
        : [],
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
  safeZ,
  entryClearance,
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
    safeZ,
    entryClearance,
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
  warnings: string[],
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
      warnings.push(
        `"${input.operation.name}" failed, so the material it would cut is taken as left.`,
      );
    }
  }
  return cuts;
}

function* operationSteps(
  { operation, shapes, model, stock, stockBottom, before, ...options }: ToolpathInput,
  context: ToolpathContext,
): Generator<number, Toolpath> {
  const { mesh, cache } = context;
  switch (operation.type) {
    case "profile":
      return profileToolpath(operation, shapes, options);
    case "pocket":
      return pocketToolpath(operation, shapes, options);
    case "drill":
      return drillToolpath(operation, shapes, options);
    case "engrave":
      return engraveToolpath(operation, shapes, options);
    case "vcarve":
      return vcarveToolpath(operation, shapes, options);
    case "relief_finish":
    case "relief_rough": {
      if (!model) return { moves: [], warnings: ["The model to machine is missing."] };
      const positions = mesh?.(model.sha256);
      if (!positions) throw new MissingMeshError(model.sha256);
      const warnings: string[] = [];
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
              cache,
              rest,
            })
          : reliefRoughSteps(operation, model, positions, {
              ...options,
              stock,
              stockBottom,
              cache,
              rest,
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
