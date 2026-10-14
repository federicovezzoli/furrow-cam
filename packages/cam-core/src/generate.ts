import {
  DEFAULT_ENTRY_CLEARANCE,
  type Operation,
  type OperationTarget,
  type ProjectDocument,
  type Shape,
} from "@furrow/document";
import { drillToolpath } from "./drill";
import { engraveToolpath } from "./engrave";
import { pocketToolpath } from "./pocket";
import { profileToolpath } from "./profile";
import type { Toolpath } from "./toolpath";

/** Retract height above the stock top when the project has no machine profile. */
export const DEFAULT_SAFE_Z = 5;

/** Everything a toolpath depends on, small enough to post to a worker. */
export type ToolpathInput = {
  operation: Operation;
  /** The operation's shapes, in its order, with only the paths it targets. */
  shapes: Shape[];
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
  const safeZ = doc.machine?.safeZ ?? DEFAULT_SAFE_Z;
  const entryClearance = doc.machine?.entryClearance ?? DEFAULT_ENTRY_CLEARANCE;
  return operations.map((operation) => ({
    operation,
    shapes: targetedShapes(shapes, operation.targets),
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
export function toolpathKey({ operation, shapes, safeZ, entryClearance }: ToolpathInput): string {
  const { name: _name, color: _color, notes: _notes, ...tool } = operation.tool;
  return JSON.stringify([
    operation.type,
    operation.params,
    tool,
    shapes.map((shape) => shape.paths),
    safeZ,
    entryClearance,
  ]);
}

/** Computes an operation's toolpath. Runs in a Web Worker (ADR-0004). */
export function generateToolpath({ operation, shapes, ...options }: ToolpathInput): Toolpath {
  switch (operation.type) {
    case "profile":
      return profileToolpath(operation, shapes, options);
    case "pocket":
      return pocketToolpath(operation, shapes, options);
    case "drill":
      return drillToolpath(operation, shapes, options);
    case "engrave":
      return engraveToolpath(operation, shapes, options);
  }
}
