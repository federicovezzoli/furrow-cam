"use client";

import { modelAt, type PathRef, pathAt, pickablePaths } from "@furrow/cam-core";
import type { Point } from "@furrow/document";
import { useEffect, useMemo } from "react";
import { belongsElsewhere } from "../../lib/keyboard-target";
import { clickedPaths } from "../../lib/path-selection";
import { POINT_MARKER_SIZE } from "../../lib/viewport-scene";
import {
  useDocumentStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../../providers/workspace-stores";
import { onStockTop, StockTopCatcher, useStockTopHover } from "./stock-top";

/** How near to a path's line, in pixels, the cursor picks it, however far zoomed. */
const PICK_RADIUS = 6;
/** Pointer travel, in pixels, past which a press is a drag rather than a click. */
const CLICK_THRESHOLD = 3;

/**
 * Selecting in the top view (#54, ADR-0080), unless the workspace is editing
 * tabs or picking the zero, which take the clicks. The path under the cursor
 * is found from the document's geometry with `pathAt` (ADR-0008), not by
 * raycasting. A click selects its whole drawing, Ctrl/Cmd/Shift+click
 * toggles it, Alt+click picks the path alone. A double click enters the
 * drawing, whose paths clicks then select one by one, the others being out
 * of reach; Esc or a double click outside leaves it. Paths win over the
 * model drawn under them (ADR-0078): a plain click on no path selects the 3D
 * model under it (PRD-0005), and a click on nothing clears the selection.
 */
export function PathPick() {
  const active = useWorkspaceStore((s) => s.view === "top" && s.editing === null && !s.pickingZero);
  return active ? <PathPicker /> : null;
}

function PathPicker() {
  const workspace = useWorkspaceStoreApi();
  const geometry = useDocumentStore((s) => s.document.geometry);
  const models = useDocumentStore((s) => s.document.models);
  const thickness = useDocumentStore((s) => s.document.stock.thickness);
  const entered = useWorkspaceStore((s) => s.enteredDrawingId);
  const all = useMemo(() => pickablePaths(geometry), [geometry]);
  const inside = useMemo(
    () => (entered === null ? all : pickablePaths(geometry.filter((s) => s.drawingId === entered))),
    [all, geometry, entered],
  );

  function pathUnder(
    paths: typeof all,
    point: Point | null,
    millimetresPerPixel: number,
  ): PathRef | null {
    // Drill points are drawn as crosses, which pick them as well as their centre.
    return (
      point &&
      pathAt(paths, point, PICK_RADIUS * millimetresPerPixel, { pointSize: POINT_MARKER_SIZE })
    );
  }

  // Hovers the path under the cursor, writing to the store only when it changes.
  const hoverHandlers = useStockTopHover((point, millimetresPerPixel) => {
    const hit = pathUnder(inside, point, millimetresPerPixel);
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

  // Esc leaves the entered drawing, unless a field or dialog uses it.
  useEffect(() => {
    if (entered === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || belongsElsewhere(event.target)) {
        return;
      }
      workspace.getState().enterDrawing(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entered, workspace]);

  return (
    <StockTopCatcher
      z={-thickness - 1}
      {...hoverHandlers}
      onClick={(event) => {
        if (event.delta > CLICK_THRESHOLD) return;
        const point = onStockTop(event.ray);
        const hit = pathUnder(inside, point, 1 / event.camera.zoom);
        const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
        const state = workspace.getState();
        if (hit) {
          const paths = clickedPaths(geometry, hit, entered !== null || event.altKey);
          state.selectPaths(paths, toggle ? "toggle" : "replace");
          return;
        }
        // Ctrl/Cmd/Shift+click adds paths, so a model under it doesn't drop the paths selected.
        const keep = toggle && state.selectedPaths.length > 0;
        const model = !keep && entered === null && point ? modelAt(models, point) : null;
        if (model) state.selectModel(model.id);
        else if (!toggle) state.selectPaths([]);
      }}
      onDoubleClick={(event) => {
        const hit = pathUnder(all, onStockTop(event.ray), 1 / event.camera.zoom);
        const state = workspace.getState();
        const shape = hit && geometry.find(({ id }) => id === hit.shapeId);
        if (!hit || !shape) {
          state.enterDrawing(null);
          return;
        }
        state.enterDrawing(shape.drawingId);
        state.selectPaths([hit]);
        // A text item's text is what a double click on it edits.
        const text = document.getElementById("text-text");
        if (text instanceof HTMLElement) text.focus();
      }}
    />
  );
}
