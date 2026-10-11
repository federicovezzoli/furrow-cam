import type { Operation, ProjectDocument, Shape } from "@furrow/document";
import { pocketToolpath } from "./pocket";
import { profileToolpath } from "./profile";
import type { Toolpath } from "./toolpath";

/** Retract height above the stock top when the project has no machine profile. */
export const DEFAULT_SAFE_Z = 5;

/** Everything a toolpath depends on, small enough to post to a worker. */
export type ToolpathInput = {
  operation: Operation;
  /** The operation's shapes, in its order. */
  shapes: Shape[];
  /** Retract height above the stock top. */
  safeZ: number;
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
  return operations.map((operation) => ({
    operation,
    shapes: operation.shapeIds.flatMap((id) => shapes.get(id) ?? []),
    safeZ,
  }));
}

/**
 * A string that changes exactly when the toolpath of `input` may change:
 * names, colours, notes and the enabled flag are left out, so renaming an
 * operation, its tool or its shapes never recomputes it.
 */
export function toolpathKey({ operation, shapes, safeZ }: ToolpathInput): string {
  const { name: _name, color: _color, notes: _notes, ...tool } = operation.tool;
  return JSON.stringify([
    operation.type,
    operation.params,
    tool,
    shapes.map((shape) => shape.paths),
    safeZ,
  ]);
}

/** Computes an operation's toolpath. Runs in a Web Worker (ADR-0004). */
export function generateToolpath({ operation, shapes, safeZ }: ToolpathInput): Toolpath {
  switch (operation.type) {
    case "profile":
      return profileToolpath(operation, shapes, { safeZ });
    case "pocket":
      return pocketToolpath(operation, shapes, { safeZ });
    case "drill":
      throw new Error(`${operation.type} toolpaths are not supported yet`);
  }
}
