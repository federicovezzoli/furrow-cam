"use client";

import { modelAt, type PathRef, pathAt, pickablePaths } from "@furrow/cam-core";
import type { Point } from "@furrow/document";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { useUnpickableIds } from "../../hooks/use-flagged-ids";
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
 * drawing, whose paths clicks then select one by one, nothing else being in
 * reach; Esc, a double click outside it or selecting something outside it
 * leaves it. Paths win over the model drawn under them (ADR-0078): a plain
 * click on no path selects the 3D model under it (PRD-0005), and a click on
 * nothing clears the selection.
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
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths);
  const drawingOf = useMemo(
    () => new Map(geometry.map((shape) => [shape.id, shape.drawingId])),
    [geometry],
  );
  // Hidden and locked shapes and models are out of reach (ADR-0080).
  const unpickable = useUnpickableIds();
  const all = useMemo(
    () => pickablePaths(geometry.filter(({ id }) => !unpickable.has(id))),
    [geometry, unpickable],
  );
  const pickableModels = useMemo(
    () => models.filter(({ id }) => !unpickable.has(id)),
    [models, unpickable],
  );
  const inside = useMemo(
    () =>
      entered === null ? all : all.filter(({ shapeId }) => drawingOf.get(shapeId) === entered),
    [all, drawingOf, entered],
  );
  /** The selection before the first click of a pair, which a double click starts from. */
  const beforeClicks = useRef<PathRef[]>([]);
  /** Alt is held, so the hover shows the path alone, as Alt+click picks it. */
  const altHeld = useRef(false);

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
    const direct = altHeld.current;
    const { hovered, setHovered } = workspace.getState();
    if (
      hovered?.shapeId !== hit?.shapeId ||
      hovered?.path !== hit?.path ||
      (hovered !== null && hovered.direct !== direct)
    ) {
      setHovered(hit && { ...hit, direct });
    }
  });

  // Leaving the mode (tab editing, picking the zero, the orbit view) drops the hover.
  useEffect(
    () => () => {
      const { hovered, setHovered } = workspace.getState();
      if (hovered) setHovered(null);
    },
    [workspace],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      altHeld.current = event.altKey;
      // Esc leaves the entered drawing, unless a field or dialog uses it.
      if (
        event.type === "keydown" &&
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !belongsElsewhere(event.target)
      ) {
        workspace.getState().enterDrawing(null);
      }
    }
    const onBlur = () => {
      altHeld.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [workspace]);

  // Selecting outside the entered drawing (a duplicate, a new text, an import) leaves it.
  useEffect(() => {
    if (
      entered !== null &&
      selectedPaths.some(({ shapeId }) => drawingOf.get(shapeId) !== entered)
    ) {
      workspace.getState().enterDrawing(null);
    }
  }, [entered, selectedPaths, drawingOf, workspace]);

  const toggles = (event: ThreeEvent<MouseEvent>) =>
    event.ctrlKey || event.metaKey || event.shiftKey;

  return (
    <StockTopCatcher
      z={-thickness - 1}
      {...hoverHandlers}
      onClick={(event) => {
        if (event.delta > CLICK_THRESHOLD) return;
        const state = workspace.getState();
        if (event.nativeEvent.detail <= 1) beforeClicks.current = state.selectedPaths;
        const point = onStockTop(event.ray);
        const hit = pathUnder(inside, point, 1 / event.camera.zoom);
        const toggle = toggles(event);
        if (hit) {
          const paths = clickedPaths(geometry, hit, entered !== null || event.altKey, unpickable);
          state.selectPaths(paths, toggle ? "toggle" : "replace");
          return;
        }
        // Ctrl/Cmd/Shift+click adds paths, so a model under it doesn't drop the paths selected.
        const keep = toggle && state.selectedPaths.length > 0;
        const model = !keep && entered === null && point ? modelAt(pickableModels, point) : null;
        if (model) state.selectModel(model.id);
        else if (!toggle) state.selectPaths([]);
      }}
      onDoubleClick={(event) => {
        const hit = pathUnder(all, onStockTop(event.ray), 1 / event.camera.zoom);
        const drawingId = hit && drawingOf.get(hit.shapeId);
        const state = workspace.getState();
        if (!hit || !drawingId) {
          // Outside the entered drawing: leave it with the paths selected before the pair.
          if (state.enteredDrawingId !== null) {
            state.selectPaths(beforeClicks.current);
            state.enterDrawing(null);
          }
          return;
        }
        // The pair's clicks selected and toggled; the double click starts from before them.
        if (toggles(event) && state.enteredDrawingId === drawingId) {
          state.selectPaths(beforeClicks.current);
          state.selectPaths([hit], "toggle");
        } else {
          state.selectPaths([hit]);
        }
        state.enterDrawing(drawingId);
      }}
    />
  );
}
