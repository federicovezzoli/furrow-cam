"use client";

import { type Box3, stockBounds, stockOffset } from "@furrow/cam-core";
import type { Shape } from "@furrow/document";
import { Edges } from "@react-three/drei";
import { useMemo } from "react";
import { boxCenter, gridLinePositions, shapesLinePositions } from "@/lib/viewport-scene";
import { useDocumentStore, useWorkspaceStore } from "@/stores/workspace-stores";
import { Lines, useLineGeometry } from "./lines";
import { type Palette, RENDER_ORDER } from "./scene-style";
import { Tabs } from "./tabs";
import { Toolpaths } from "./toolpaths";

/** Length in millimetres of the origin marker's axes. */
const ORIGIN_MARKER_SIZE = 40;

export function Scene({ box, palette }: { box: Box3; palette: Palette }) {
  return (
    <>
      <WorkOrigin palette={palette} />
      <Stock box={box} palette={palette} />
      <Shapes palette={palette} />
      <Toolpaths palette={palette} />
      <Tabs color={palette.tab} />
    </>
  );
}

/** The origin marker and the grid aligned to it, placed where the stock's origin settings say. */
function WorkOrigin({ palette }: { palette: Palette }) {
  const stock = useDocumentStore((s) => s.document.stock);
  const offset = useMemo(() => stockOffset(stock), [stock]);
  const { minor, major } = useMemo(() => gridLinePositions(stockBounds(stock)), [stock]);
  const minorGeometry = useLineGeometry(minor);
  const majorGeometry = useLineGeometry(major);
  return (
    // Work coordinates are stock coordinates moved by `offset`, so this undoes it.
    <group position={[-offset[0], -offset[1], -offset[2]]}>
      <lineSegments geometry={minorGeometry}>
        <lineBasicMaterial color={palette.gridMinor} />
      </lineSegments>
      <lineSegments geometry={majorGeometry}>
        <lineBasicMaterial color={palette.gridMajor} />
      </lineSegments>
      {/* X red, Y green, Z blue; drawn over the stock edges it may run along. */}
      <axesHelper
        args={[ORIGIN_MARKER_SIZE]}
        renderOrder={RENDER_ORDER.origin}
        material-transparent
        material-depthTest={false}
      />
    </group>
  );
}

function Stock({ box, palette }: { box: Box3; palette: Palette }) {
  const { min, max } = box;
  return (
    <mesh position={boxCenter(box)} renderOrder={RENDER_ORDER.stock}>
      <boxGeometry args={[max[0] - min[0], max[1] - min[1], max[2] - min[2]]} />
      {/* Not writing depth, so lines drawn after it on its top face always show. */}
      <meshBasicMaterial color={palette.stock} transparent opacity={0.25} depthWrite={false} />
      <Edges color={palette.stockEdges} />
    </mesh>
  );
}

/**
 * Imported geometry on the stock top: all shapes in one draw call, then the
 * selected and hovered shapes (from the workspace store) drawn over them.
 * Each layer subscribes on its own, so hovering redraws only its overlay.
 */
function Shapes({ palette }: { palette: Palette }) {
  return (
    <>
      <AllShapes color={palette.shape} />
      <SelectedShapes color={palette.selected} />
      <HoveredShape color={palette.hovered} />
    </>
  );
}

function AllShapes({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const positions = useMemo(() => shapesLinePositions(geometry), [geometry]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.shapes} />;
}

function SelectedShapes({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selectedIds = useWorkspaceStore((s) => s.selectedShapeIds);
  const positions = useMemo(() => {
    const selected = new Set(selectedIds);
    return shapesLinePositions(geometry.filter((shape) => selected.has(shape.id)));
  }, [geometry, selectedIds]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.selected} />;
}

/** The hovered shape, unless it is selected: selection wins. */
function HoveredShape({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const hoveredId = useWorkspaceStore((s) =>
    s.hoveredShapeId !== null && !s.selectedShapeIds.includes(s.hoveredShapeId)
      ? s.hoveredShapeId
      : null,
  );
  const positions = useMemo(() => {
    const hovered = geometry.filter((shape: Shape) => shape.id === hoveredId);
    return shapesLinePositions(hovered);
  }, [geometry, hoveredId]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.hovered} />;
}
