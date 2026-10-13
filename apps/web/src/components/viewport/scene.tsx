"use client";

import { type Box3, type Heightmap, pathKey, stockBounds, stockOffset } from "@furrow/cam-core";
import { Edges } from "@react-three/drei";
import { useMemo } from "react";
import {
  boxCenter,
  gridLinePositions,
  pathsLinePositions,
  shapesLinePositions,
} from "@/lib/viewport-scene";
import { useDocumentStore, useWorkspaceStore } from "@/stores/workspace-stores";
import { Lines, useLineGeometry } from "./lines";
import { PathPick } from "./path-pick";
import { type Palette, RENDER_ORDER } from "./scene-style";
import { SimulatedStock } from "./simulated-stock";
import { Tabs } from "./tabs";
import { Toolpaths } from "./toolpaths";
import { ZeroPick } from "./zero-pick";

/** Length in millimetres of the origin marker's axes. */
const ORIGIN_MARKER_SIZE = 40;

/**
 * With a `heightmap`, the scene shows the stock as simulated after cutting in
 * place of the stock box; the toolpaths stay, as the Operations pane shows or
 * hides them.
 */
export function Scene({
  box,
  palette,
  heightmap,
}: {
  box: Box3;
  palette: Palette;
  heightmap: Heightmap | null;
}) {
  return (
    <>
      <WorkOrigin palette={palette} />
      {heightmap ? (
        <SimulatedStock heightmap={heightmap} thickness={-box.min[2]} color={palette.stock} />
      ) : (
        <Stock box={box} palette={palette} />
      )}
      <Shapes palette={palette} />
      <Toolpaths palette={palette} />
      <Tabs color={palette.tab} />
      <ZeroPick color={palette.snap} />
      <PathPick />
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
 * selected and hovered paths (from the workspace store) drawn over them.
 * Each layer subscribes on its own, so hovering redraws only its overlay.
 */
function Shapes({ palette }: { palette: Palette }) {
  return (
    <>
      <AllShapes color={palette.shape} />
      <SelectedPaths color={palette.selected} />
      <HoveredPaths color={palette.hovered} />
    </>
  );
}

function AllShapes({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const positions = useMemo(() => shapesLinePositions(geometry), [geometry]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.shapes} />;
}

function SelectedPaths({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selected = useWorkspaceStore((s) => s.selectedPaths);
  const positions = useMemo(() => {
    const shapes = new Map(geometry.map((shape) => [shape.id, shape]));
    const paths = selected.flatMap(({ shapeId, path }) => shapes.get(shapeId)?.paths[path] ?? []);
    return pathsLinePositions(paths);
  }, [geometry, selected]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.selected} />;
}

/** The hovered path, or the hovered shape's paths, except selected ones: selection wins. */
function HoveredPaths({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const hovered = useWorkspaceStore((s) => s.hovered);
  const selected = useWorkspaceStore((s) => s.selectedPaths);
  // Built when the geometry or the selection changes, not each time the hover does.
  const shapes = useMemo(() => new Map(geometry.map((shape) => [shape.id, shape])), [geometry]);
  const selectedKeys = useMemo(() => new Set(selected.map(pathKey)), [selected]);
  const positions = useMemo(() => {
    const shape = hovered && shapes.get(hovered.shapeId);
    if (!hovered || !shape) return pathsLinePositions([]);
    const paths = shape.paths.filter(
      (_, path) =>
        (hovered.path === null || hovered.path === path) &&
        !selectedKeys.has(pathKey({ shapeId: shape.id, path })),
    );
    return pathsLinePositions(paths);
  }, [shapes, hovered, selectedKeys]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.hovered} />;
}
