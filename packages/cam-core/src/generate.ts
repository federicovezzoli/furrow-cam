import type { Operation, ProjectDocument, Shape } from "@furrow/document";
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
  const shapes = new Map(doc.geometry.map((shape) => [shape.id, shape]));
  return {
    operation,
    shapes: operation.shapeIds.flatMap((id) => shapes.get(id) ?? []),
    safeZ: doc.machine?.safeZ ?? DEFAULT_SAFE_Z,
  };
}

/** Computes an operation's toolpath. Runs in a Web Worker (ADR-0004). */
export function generateToolpath({ operation, shapes, safeZ }: ToolpathInput): Toolpath {
  switch (operation.type) {
    case "profile":
      return profileToolpath(operation, shapes, { safeZ });
    case "pocket":
    case "drill":
      throw new Error(`${operation.type} toolpaths are not supported yet`);
  }
}
