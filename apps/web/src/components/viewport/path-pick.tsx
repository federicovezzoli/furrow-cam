"use client";

import { type PathRef, pathAt, pickablePaths } from "@furrow/cam-core";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type Camera, type OrthographicCamera, type Ray, Raycaster } from "three";
import {
  useDocumentStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/stores/workspace-stores";
import { onStockTop, StockTopCatcher } from "./stock-top";

/** How near to a path's line, in pixels, the cursor picks it, however far zoomed. */
const PICK_RADIUS = 6;
/** Pointer travel, in pixels, past which a press is a drag rather than a click. */
const CLICK_THRESHOLD = 3;

/**
 * Selecting paths in the top view (#54), unless the workspace is editing tabs
 * or picking the zero, which take the clicks. The path under the cursor is
 * found from the document's geometry with `pathAt` (ADR-0008), not by
 * raycasting, and hovered; a click selects it, Ctrl/Cmd/Shift+click toggles
 * it, and a click on nothing clears the selection.
 */
export function PathPick() {
  const active = useWorkspaceStore((s) => s.view === "top" && !s.editingTabs && !s.pickingZero);
  return active ? <PathPicker /> : null;
}

function PathPicker() {
  const workspace = useWorkspaceStoreApi();
  const geometry = useDocumentStore((s) => s.document.geometry);
  const thickness = useDocumentStore((s) => s.document.stock.thickness);
  // Flattened once per geometry, not on every pointer move.
  const paths = useMemo(() => pickablePaths(geometry), [geometry]);
  const over = useRef(false);
  const raycaster = useMemo(() => new Raycaster(), []);

  function pathUnder(ray: Ray, camera: Camera): PathRef | null {
    const point = onStockTop(ray);
    // The top view is orthographic: its zoom is in pixels per millimetre.
    return point && pathAt(paths, point, PICK_RADIUS / (camera as OrthographicCamera).zoom);
  }

  /** Hovers the path at `ray`, writing to the store only when it changes. */
  function hoverAt(ray: Ray | null, camera: Camera) {
    const hit = ray && pathUnder(ray, camera);
    const { hovered, setHovered } = workspace.getState();
    if (hovered?.shapeId !== hit?.shapeId || hovered?.path !== hit?.path) setHovered(hit);
  }

  // Panning or zooming moves the geometry under a still cursor: hover again
  // from where the pointer last was.
  useFrame(({ camera, pointer }) => {
    if (!over.current) return;
    raycaster.setFromCamera(pointer, camera);
    hoverAt(raycaster.ray, camera);
  });

  // Leaving the mode (tab editing, picking the zero, the orbit view) drops the
  // viewport's hover; a shape hovered in the Geometry pane stays.
  useEffect(
    () => () => {
      const { hovered, setHovered } = workspace.getState();
      if (hovered && hovered.path !== null) setHovered(null);
    },
    [workspace],
  );

  return (
    <StockTopCatcher
      z={-thickness - 1}
      onPointerMove={(event) => {
        over.current = true;
        hoverAt(event.ray, event.camera);
      }}
      onPointerOut={(event) => {
        over.current = false;
        hoverAt(null, event.camera);
      }}
      onClick={(event) => {
        if (event.delta > CLICK_THRESHOLD) return;
        const hit = pathUnder(event.ray, event.camera);
        const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
        if (hit) workspace.getState().selectPaths([hit], toggle ? "toggle" : "replace");
        else if (!toggle) workspace.getState().selectPaths([]);
      }}
    />
  );
}
