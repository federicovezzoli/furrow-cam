"use client";

import { modelAt, type PathRef, pathAt, pickablePaths } from "@furrow/cam-core";
import type { Point } from "@furrow/document";
import { useEffect, useMemo } from "react";
import { POINT_MARKER_SIZE } from "@/features/workspace/lib/viewport-scene";
import {
  useDocumentStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/features/workspace/providers/workspace-stores";
import { onStockTop, StockTopCatcher, useStockTopHover } from "./stock-top";

/** How near to a path's line, in pixels, the cursor picks it, however far zoomed. */
const PICK_RADIUS = 6;
/** Pointer travel, in pixels, past which a press is a drag rather than a click. */
const CLICK_THRESHOLD = 3;

/**
 * Selecting paths in the top view (#54), unless the workspace is editing tabs
 * or picking the zero, which take the clicks. The path under the cursor is
 * found from the document's geometry with `pathAt` (ADR-0008), not by
 * raycasting, and hovered; a click selects it, Ctrl/Cmd/Shift+click toggles
 * it. A click on no path selects the 3D model under it (PRD-0005), the one
 * added last where several overlap, and a click on nothing clears the
 * selection.
 */
export function PathPick() {
  const active = useWorkspaceStore((s) => s.view === "top" && !s.editingTabs && !s.pickingZero);
  return active ? <PathPicker /> : null;
}

function PathPicker() {
  const workspace = useWorkspaceStoreApi();
  const geometry = useDocumentStore((s) => s.document.geometry);
  const models = useDocumentStore((s) => s.document.models);
  const thickness = useDocumentStore((s) => s.document.stock.thickness);
  const paths = useMemo(() => pickablePaths(geometry), [geometry]);

  function pathUnder(point: Point | null, millimetresPerPixel: number): PathRef | null {
    // Drill points are drawn as crosses, which pick them as well as their centre.
    return (
      point &&
      pathAt(paths, point, PICK_RADIUS * millimetresPerPixel, { pointSize: POINT_MARKER_SIZE })
    );
  }

  // Hovers the path under the cursor, writing to the store only when it changes.
  const hoverHandlers = useStockTopHover((point, millimetresPerPixel) => {
    const hit = pathUnder(point, millimetresPerPixel);
    const { hovered, setHovered } = workspace.getState();
    if (hovered?.shapeId !== hit?.shapeId || hovered?.path !== hit?.path) setHovered(hit);
  });

  // Leaving the mode (tab editing, picking the zero, the orbit view) drops the hover.
  useEffect(
    () => () => {
      const { hovered, setHovered } = workspace.getState();
      if (hovered) setHovered(null);
    },
    [workspace],
  );

  return (
    <StockTopCatcher
      z={-thickness - 1}
      {...hoverHandlers}
      onClick={(event) => {
        if (event.delta > CLICK_THRESHOLD) return;
        const point = onStockTop(event.ray);
        const hit = pathUnder(point, 1 / event.camera.zoom);
        const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
        const model = !hit && point ? modelAt(models, point) : null;
        if (hit) workspace.getState().selectPaths([hit], toggle ? "toggle" : "replace");
        else if (model) workspace.getState().selectModel(model.id);
        else if (!toggle) workspace.getState().selectPaths([]);
      }}
    />
  );
}
