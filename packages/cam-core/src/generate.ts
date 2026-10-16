import {
  DEFAULT_ENTRY_CLEARANCE,
  type Model,
  type Operation,
  type OperationTarget,
  operationModelId,
  type ProjectDocument,
  type Shape,
} from "@furrow/document";
import { drillToolpath } from "./drill";
import { engraveToolpath } from "./engrave";
import { pocketToolpath } from "./pocket";
import { profileToolpath } from "./profile";
import { type ReliefCache, reliefFinishSteps, runSteps } from "./relief";
import type { Toolpath } from "./toolpath";
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
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts. */
  entryClearance: number;
};

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
  return operations.map((operation) => ({
    operation,
    shapes: targetedShapes(shapes, operation.targets),
    model: models.get(operationModelId(operation) ?? "") ?? null,
    safeZ,
    entryClearance,
  }));
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
 * operation, its tool or its shapes never recomputes it.
 */
export function toolpathKey({
  operation,
  shapes,
  model,
  safeZ,
  entryClearance,
}: ToolpathInput): string {
  const { name: _name, color: _color, notes: _notes, ...tool } = operation.tool;
  return JSON.stringify([
    operation.type,
    operation.params,
    tool,
    shapes.map((shape) => shape.paths),
    model && [model.sha256, model.bounds, model.placement],
    safeZ,
    entryClearance,
  ]);
}

/** What toolpaths of 3D operations need besides their input. */
export type ToolpathContext = {
  /** The triangles of the mesh with this hash (`StlMesh.positions`), if loaded. */
  mesh?: (sha256: string) => Float32Array | undefined;
  /** Model heightmaps kept between toolpaths. */
  cache?: ReliefCache;
};

/** Thrown when a 3D operation's mesh isn't in the `ToolpathContext`. */
export class MissingMeshError extends Error {
  override name = "MissingMeshError";

  constructor(readonly sha256: string) {
    super("The model's mesh isn't loaded");
  }
}

/**
 * Computes an operation's toolpath, yielding the fraction done as it goes
 * (3D operations only; the others yield nothing), so a Web Worker can report
 * progress and stop between steps (ADR-0004).
 */
export function* toolpathSteps(
  { operation, shapes, model, ...options }: ToolpathInput,
  { mesh, cache }: ToolpathContext = {},
): Generator<number, Toolpath> {
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
    case "relief_finish": {
      if (!model) return { moves: [], warnings: ["The model to machine is missing."] };
      const positions = mesh?.(model.sha256);
      if (!positions) throw new MissingMeshError(model.sha256);
      return yield* reliefFinishSteps(operation, model, positions, { ...options, cache });
    }
  }
}

/** Computes an operation's toolpath. Runs in a Web Worker (ADR-0004). */
export function generateToolpath(input: ToolpathInput, context?: ToolpathContext): Toolpath {
  return runSteps(toolpathSteps(input, context));
}
