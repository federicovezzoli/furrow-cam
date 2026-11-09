import { flaggedIds } from "@furrow/cam-core";
import type { ProjectDocument, Shape } from "@furrow/document";
import { useDocumentStore } from "../providers/workspace-stores";

type Flags = {
  hidden: ReadonlySet<string>;
  locked: ReadonlySet<string>;
  /** Hidden or locked: what the viewport can't pick or move. */
  unpickable: ReadonlySet<string>;
  /** The shapes not hidden, in document order. */
  shown: Shape[];
};

/**
 * The last objects' flags, shared by every reader: worked out once per change
 * of the drawings, shapes or models, not once per component.
 */
let last: { objects: unknown[]; flags: Flags } | null = null;

function flagsOf({ drawings, geometry, models }: ProjectDocument): Flags {
  if (last?.objects[0] === drawings && last.objects[1] === geometry && last.objects[2] === models) {
    return last.flags;
  }
  const objects = { drawings, geometry, models };
  const hidden = flaggedIds(objects, "hidden");
  const locked = flaggedIds(objects, "locked");
  const flags: Flags = {
    hidden,
    locked,
    unpickable: new Set([...hidden, ...locked]),
    shown: hidden.size === 0 ? geometry : geometry.filter(({ id }) => !hidden.has(id)),
  };
  last = { objects: [drawings, geometry, models], flags };
  return flags;
}

/**
 * The ids of the hidden, or the locked, shapes and models (ADR-0080), with
 * a drawing's flag on all its shapes, or (`"unpickable"`) both.
 */
export function useFlaggedIds(flag: "hidden" | "locked" | "unpickable"): ReadonlySet<string> {
  return useDocumentStore((s) => flagsOf(s.document)[flag]);
}

/** The ids of the shapes and models the viewport can't pick or move: hidden or locked. */
export function useUnpickableIds(): ReadonlySet<string> {
  return useFlaggedIds("unpickable");
}

/** The shapes not hidden (ADR-0080). */
export function useShownShapes(): Shape[] {
  return useDocumentStore((s) => flagsOf(s.document).shown);
}
