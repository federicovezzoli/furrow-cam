import { useMemo } from "react";
import { selectionTargets } from "../lib/path-selection";
import { useDocumentStore, useWorkspaceStore } from "../providers/workspace-stores";

/** The selected paths' operation targets (`selectionTargets`), kept while neither changes. */
export function useSelectionTargets() {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths);
  return useMemo(() => selectionTargets(geometry, selectedPaths), [geometry, selectedPaths]);
}
