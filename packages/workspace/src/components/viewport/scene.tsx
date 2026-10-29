"use client";

import {
  activeTouchOff,
  type Box3,
  type Heightmap,
  pathKey,
  pinCenters,
  stockBounds,
  stockOffset,
} from "@furrow/cam-core";
import { type Point, stockPins } from "@furrow/document";
import { Edges, Html } from "@react-three/drei";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { useSelectedDrawingId } from "../../hooks/use-selected-drawing";
import {
  boxCenter,
  concatPositions,
  gridLinePositions,
  pathsLinePositions,
  shapesLinePositions,
  touchOffLinePositions,
} from "../../lib/viewport-scene";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "../../providers/workspace-stores";
import { drawingBounds, moveDrawing } from "../../stores/geometry-actions";
import type { ModelPreview } from "../../stores/model-preview-scheduler";
import { DashedLines, Lines, useLineGeometry, WideLines } from "./lines";
import { Models } from "./models";
import { PathPick } from "./path-pick";
import { type Palette, RENDER_ORDER } from "./scene-style";
import { SideFrame } from "./side-frame";
import { SimulatedStock } from "./simulated-stock";
import { onStockTop } from "./stock-top";
import { HoldingTabs, Tabs } from "./tabs";
import { Toolpaths } from "./toolpaths";
import { ZeroPick } from "./zero-pick";

/** Length in millimetres of the origin marker's axes. */
const ORIGIN_MARKER_SIZE = 40;

/**
 * With a `heightmap`, the scene shows the stock as simulated after cutting in
 * place of the stock box and the models; the toolpaths stay, as the
 * Operations pane shows or hides them. `modelPreviews` draw the models.
 */
export function Scene({
  box,
  palette,
  heightmap,
  modelPreviews,
}: {
  box: Box3;
  palette: Palette;
  heightmap: Heightmap | null;
  modelPreviews: ReadonlyMap<string, ModelPreview>;
}) {
  const topSide = useWorkspaceStore((s) => s.side === "top");
  return (
    <>
      <WorkOrigin palette={palette} />
      <TouchOffPad color={palette.touchOff} />
      <LocatingPins color={palette.pin} />
      {/* The simulation is of the side in view; the stock looks the same from either. */}
      {heightmap ? (
        <SimulatedStock heightmap={heightmap} thickness={-box.min[2]} color={palette.stock} />
      ) : (
        <Stock box={box} palette={palette} />
      )}
      {/* In the top side's coordinates: turned over in the bottom side's view (ADR-0060). */}
      <SideFrame side="top">
        {!heightmap && <Models previews={modelPreviews} palette={palette} />}
        <Shapes palette={palette} />
        <Tabs color={palette.tab} />
        <HoldingTabs color={palette.tab} />
      </SideFrame>
      <Toolpaths palette={palette} />
      {/* Picking works on the top side only, which the drawing is in. */}
      {topSide && (
        <>
          <ZeroPick color={palette.snap} />
          <PathPick />
        </>
      )}
    </>
  );
}

/** The origin marker and the grid aligned to it, placed where the stock's origin settings say. */
export function WorkOrigin({ palette }: { palette: Palette }) {
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

/**
 * The touch-off pad (#147, ADR-0041) on the stock top, drawn as a spot to
 * zero on rather than a solid object (ADR-0043): a dashed ring at its
 * diameter, a cross at its centre and a label a fixed size on screen, in a
 * colour of its own. Not drawn with Z zeroed on the machine bed, where it
 * isn't used.
 */
function TouchOffPad({ color }: { color: string }) {
  const pad = useDocumentStore((s) => activeTouchOff(s.document.stock));
  const lines = useMemo(() => pad && touchOffLinePositions(pad), [pad]);
  if (!pad || !lines) return null;
  return (
    <>
      <DashedLines
        positions={lines.ring}
        distances={lines.distances}
        color={color}
        renderOrder={RENDER_ORDER.origin}
        overlay
      />
      <Lines positions={lines.cross} color={color} renderOrder={RENDER_ORDER.origin} overlay />
      <Html position={[pad.x + pad.diameter / 2, pad.y, 0]} style={{ pointerEvents: "none" }}>
        <div
          className="ml-1.5 -translate-y-1/2 rounded-sm bg-background/80 px-1 font-medium text-[10px] whitespace-nowrap"
          style={{ color }}
        >
          Z touch-off
        </div>
      </Html>
    </>
  );
}

/**
 * The locating pins (#356): a ring at their diameter and a cross at each
 * centre, on the face in view. They are on the line the stock turns about,
 * so in the same place from either side.
 */
function LocatingPins({ color }: { color: string }) {
  const stock = useDocumentStore((s) => s.document.stock);
  const positions = useMemo(() => {
    const diameter = stockPins(stock)?.diameter ?? 0;
    return concatPositions(
      pinCenters(stock).flatMap(([x, y]) => {
        const { ring, cross } = touchOffLinePositions({ x, y, diameter });
        return [ring, cross];
      }),
    );
  }, [stock]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.origin} overlay />;
}

export function Stock({ box, palette }: { box: Box3; palette: Palette }) {
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
      <SelectedDrawing color={palette.selectedDrawing} />
      <AllShapes color={palette.shape} />
      <SelectedPaths color={palette.selected} halo={palette.selectedHalo} />
      <HoveredPaths color={palette.hovered} />
    </>
  );
}

function AllShapes({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const positions = useMemo(() => shapesLinePositions(geometry), [geometry]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.shapes} />;
}

/** Pointer travel, in pixels, before a press on the selected drawing becomes a drag rather than a click. */
const DRAWING_DRAG_THRESHOLD = 3;

/** A press on the selected drawing, which becomes a drag once the pointer moves far enough. */
type DrawingPress = { pointerId: number; x: number; y: number; last: Point; dragging: boolean };

/**
 * A faint fill over the box of the drawing whose properties show, setting it
 * apart from the others. In the top view, dragging it moves the drawing
 * (PRD-0009 D5), one undo step per drag, showing the move cursor only then;
 * a click goes through to the paths.
 */
function SelectedDrawing({ color }: { color: string }) {
  const id = useSelectedDrawingId();
  const geometry = useDocumentStore((s) => s.document.geometry);
  const bounds = useMemo(() => (id === null ? null : drawingBounds(geometry, id)), [geometry, id]);
  const draggable = useWorkspaceStore(
    (s) => s.view === "top" && s.side === "top" && !s.editingTabs && !s.pickingZero,
  );
  const store = useDocumentStoreApi();
  const canvas = useThree((s) => s.gl.domElement);
  const press = useRef<DrawingPress | null>(null);

  // A drag cut short by unmounting (an undo, a deselection) is cancelled.
  useEffect(
    () => () => {
      if (press.current?.dragging) store.getState().cancelTransaction();
      canvas.style.cursor = "";
    },
    [store, canvas],
  );

  if (!bounds || id === null) return null;
  const { min, max } = bounds;

  function end(event: ThreeEvent<PointerEvent>, cancelled: boolean) {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    (event.target as Element).releasePointerCapture(event.pointerId);
    press.current = null;
    if (!current.dragging) return;
    canvas.style.cursor = "";
    const state = store.getState();
    if (cancelled) state.cancelTransaction();
    else state.commitTransaction();
  }

  return (
    <mesh
      position={[(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, 0]}
      renderOrder={RENDER_ORDER.selectedDrawing}
      {...(draggable && {
        onPointerDown: (event: ThreeEvent<PointerEvent>) => {
          const point = onStockTop(event.ray);
          if (event.button !== 0 || !point) return;
          (event.target as Element).setPointerCapture(event.pointerId);
          press.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            last: point,
            dragging: false,
          };
        },
        onPointerMove: (event: ThreeEvent<PointerEvent>) => {
          const current = press.current;
          if (!current || current.pointerId !== event.pointerId) return;
          if (!current.dragging) {
            const travel = Math.hypot(event.clientX - current.x, event.clientY - current.y);
            if (travel < DRAWING_DRAG_THRESHOLD) return;
            current.dragging = true;
            store.getState().beginTransaction();
            // Only while dragging: on hover, a click still selects the path under the pointer.
            canvas.style.cursor = "move";
          }
          const point = onStockTop(event.ray);
          if (!point) return;
          moveDrawing(store, id, [point[0] - current.last[0], point[1] - current.last[1]]);
          current.last = point;
        },
        onPointerUp: (event: ThreeEvent<PointerEvent>) => end(event, false),
        onPointerCancel: (event: ThreeEvent<PointerEvent>) => end(event, true),
      })}
    >
      <planeGeometry args={[max[0] - min[0], max[1] - min[1]]} />
      <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
    </mesh>
  );
}

/** The selected paths, wide over a wider, faint halo, so they show on the stock whatever its colour. */
function SelectedPaths({ color, halo }: { color: string; halo: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selected = useWorkspaceStore((s) => s.selectedPaths);
  const positions = useMemo(() => {
    const shapes = new Map(geometry.map((shape) => [shape.id, shape]));
    const paths = selected.flatMap(({ shapeId, path }) => shapes.get(shapeId)?.paths[path] ?? []);
    return pathsLinePositions(paths);
  }, [geometry, selected]);
  return (
    <>
      <WideLines
        positions={positions}
        color={halo}
        width={6}
        opacity={0.2}
        renderOrder={RENDER_ORDER.selected}
      />
      <WideLines
        positions={positions}
        color={color}
        width={1}
        renderOrder={RENDER_ORDER.selected}
      />
    </>
  );
}

/** The hovered path, unless it is selected: selection wins. */
function HoveredPaths({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const hovered = useWorkspaceStore((s) => s.hovered);
  const selected = useWorkspaceStore((s) => s.selectedPaths);
  // Built when the geometry or the selection changes, not each time the hover does.
  const shapes = useMemo(() => new Map(geometry.map((shape) => [shape.id, shape])), [geometry]);
  const selectedKeys = useMemo(() => new Set(selected.map(pathKey)), [selected]);
  const positions = useMemo(() => {
    const path = hovered && shapes.get(hovered.shapeId)?.paths[hovered.path];
    if (!hovered || !path || selectedKeys.has(pathKey(hovered))) return pathsLinePositions([]);
    return pathsLinePositions([path]);
  }, [shapes, hovered, selectedKeys]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.hovered} />;
}
