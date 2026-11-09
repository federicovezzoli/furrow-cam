import { flaggedIds } from "@furrow/cam-core";
import { useMemo } from "react";
import { useDocumentStore } from "../providers/workspace-stores";

/**
 * The ids of the hidden, or the locked, shapes and models (ADR-0080), with
 * a drawing's flag on all its shapes: rebuilt only when an object changes.
 */
export function useFlaggedIds(flag: "hidden" | "locked"): ReadonlySet<string> {
  const drawings = useDocumentStore((s) => s.document.drawings);
  const geometry = useDocumentStore((s) => s.document.geometry);
  const models = useDocumentStore((s) => s.document.models);
  return useMemo(
    () => flaggedIds({ drawings, geometry, models }, flag),
    [drawings, geometry, models, flag],
  );
}

/** The ids of the shapes and models the viewport can't pick or move: hidden or locked. */
export function useUnpickableIds(): ReadonlySet<string> {
  const hidden = useFlaggedIds("hidden");
  const locked = useFlaggedIds("locked");
  return useMemo(() => new Set([...hidden, ...locked]), [hidden, locked]);
}
