import { useMemo } from "react";
import { selectedDrawingId } from "../lib/path-selection";
import { useDocumentStore, useWorkspaceStore } from "../providers/workspace-stores";

/**
 * The drawing whose properties float over the viewport (PRD-0009 D2): the
 * one the selected paths belong to, while no operation or model takes the
 * panel. The viewport highlights the same one.
 */
export function useSelectedDrawingId(): string | null {
  const free = useWorkspaceStore(
    (s) => s.selectedOperationId === null && s.selectedModelId === null,
  );
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths);
  const geometry = useDocumentStore((s) => s.document.geometry);
  return useMemo(
    () => (free ? selectedDrawingId(geometry, selectedPaths) : null),
    [free, geometry, selectedPaths],
  );
}
