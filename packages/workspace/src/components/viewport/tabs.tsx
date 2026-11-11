"use client";

import {
  closedLoops,
  excludeOvercuts,
  grooveWidth,
  holdingTabStrips,
  holeSnapTargets,
  modelOutlines,
  nearestHoleSnap,
  nearestOnLoops,
  profileOvercuts,
  snapEdges,
  snapStartPoint,
  startPointCentres,
  startPointPaths,
  type TabFrame,
  tabFrame,
  targetedShapes,
  type Vec3,
} from "@furrow/cam-core";
import type { DrillOperation, Operation, Point } from "@furrow/document";
import { Edges } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Mesh } from "three";
import { touchOffLinePositions } from "../../lib/viewport-scene";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "../../providers/workspace-stores";
import {
  addEntry,
  addHole,
  addStartPoint,
  addTab,
  excludeOvercut,
  moveEntry,
  moveStartPoint,
  moveTab,
  removeEntry,
  removeHole,
  removeStartPoint,
  removeTab,
  restoreOvercut,
} from "../../stores/operation-actions";
import { moveHoldingTab } from "../../stores/stock-actions";
import { DashedLines, Lines } from "./lines";
import { RENDER_ORDER } from "./scene-style";
import { onStockTop, StockTopCatcher, useStockTopHover } from "./stock-top";
import { CLICK_THRESHOLD, SNAP_RADIUS, SnapHover, type SnapPick, samePick } from "./zero-pick";

/** Radius in pixels of the area around a tab that grabs it, however far zoomed out. */
const TAB_GRAB_RADIUS = 6;
/** How near to a contour, in pixels, a click adds a tab. */
const TAB_PICK_DISTANCE = 10;
/** Pointer travel, in pixels, before a press on a tab becomes a drag rather than a click. */
const TAB_DRAG_THRESHOLD = 3;

/** The selected operation, if any. */
function useSelectedOperation(): Operation | undefined {
  const id = useWorkspaceStore((s) => s.selectedOperationId);
  return useDocumentStore((s) => s.document.operations.find((candidate) => candidate.id === id));
}

/**
 * The selected profile's tabs, drawn as the material they leave: a box the
 * tab's width along the contour, the tool's slot across and the tab's height
 * up from the final depth. While the workspace edits them (top view only), a
 * click near one of the profile's contours adds a tab there, dragging a tab
 * moves it along the contours and clicking it removes it.
 */
export function Tabs({ color }: { color: string }) {
  const selected = useSelectedOperation();
  const operation = selected?.type === "profile" && selected.params.tabs ? selected : null;
  const editing = useWorkspaceStore((s) => s.editing === "tabs");
  const geometry = useDocumentStore((s) => s.document.geometry);
  const store = useDocumentStoreApi();
  const targets = operation?.targets;
  // Only the paths the profile cuts, as its toolpath has them.
  const shapes = useMemo(
    () => targetedShapes(new Map(geometry.map((shape) => [shape.id, shape])), targets ?? []),
    [geometry, targets],
  );
  // Flattened once per set of shapes, not on every pointer move.
  const loops = useMemo(() => closedLoops(shapes), [shapes]);
  const tabs = operation?.params.tabs;
  const side = operation?.params.side;
  const diameter = operation?.tool.diameter;
  const positions = tabs?.positions;
  const frames = useMemo(
    () =>
      side && diameter && positions
        ? positions.map((position) => tabFrame(loops, side, position, diameter))
        : [],
    [loops, side, diameter, positions],
  );
  if (!operation || !tabs) return null;
  const { depth } = operation.params;
  const height = Math.min(tabs.height, depth);

  function add(event: ThreeEvent<MouseEvent>) {
    if (!operation || event.delta > TAB_DRAG_THRESHOLD) return;
    const point = onStockTop(event.ray);
    const nearest = point && nearestOnLoops(loops, point);
    // The top view is orthographic: its zoom is in pixels per millimetre.
    if (nearest && nearest.distance <= TAB_PICK_DISTANCE / event.camera.zoom) {
      addTab(store, operation.id, nearest.point);
    }
  }

  return (
    <>
      {editing && (
        // Below the tabs, so a click on one reaches it first and stops here.
        <StockTopCatcher z={-depth - 1} onClick={add} />
      )}
      {frames.map((frame, index) => (
        <TabMarker
          // Positions have no ids; a marker keeps its index while dragged.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          frame={frame ?? { center: tabs.positions[index] as Point, angle: 0 }}
          z={height / 2 - depth}
          editing={editing}
          onMove={(point) => {
            const nearest = nearestOnLoops(loops, point);
            if (nearest) moveTab(store, operation.id, index, nearest.point);
          }}
          onRemove={() => removeTab(store, operation.id, index)}
        >
          <TabBox size={[tabs.width, operation.tool.diameter, height]} color={color} />
        </TabMarker>
      ))}
    </>
  );
}

/**
 * A two-sided project's holding tabs (PRD-0011 B5, ADR-0063), in the top
 * side's coordinates: each a strip from the model's outline to the stock's
 * edge, as wide and thick as the tabs, just below the parting plane. In the
 * top view of the top side, dragging one moves it along the outlines.
 */
export function HoldingTabs({ color }: { color: string }) {
  const stock = useDocumentStore((s) => s.document.stock);
  const models = useDocumentStore((s) => s.document.models);
  const editing = useWorkspaceStore(
    (s) => s.view === "top" && s.side === "top" && s.editing === null && !s.pickingZero,
  );
  const store = useDocumentStoreApi();
  const loops = useMemo(() => modelOutlines(models), [models]);
  const tabs = stock.twoSided?.tabs;
  const strips = useMemo(
    () => (tabs ? holdingTabStrips(stock, models, tabs) : []),
    [stock, models, tabs],
  );
  if (!stock.twoSided || !tabs) return null;
  const { partingDepth } = stock.twoSided;

  return strips.map(({ at, to }, index) => (
    <TabMarker
      // Positions have no ids; a marker keeps its index while dragged.
      // biome-ignore lint/suspicious/noArrayIndexKey: see above
      key={index}
      frame={{
        center: [(at[0] + to[0]) / 2, (at[1] + to[1]) / 2],
        angle: Math.atan2(to[1] - at[1], to[0] - at[0]),
      }}
      z={-partingDepth - tabs.thickness / 2}
      editing={editing}
      onMove={(point) => {
        const nearest = nearestOnLoops(loops, point);
        if (nearest) moveHoldingTab(store, index, nearest.point);
      }}
    >
      <TabBox
        size={[Math.hypot(to[0] - at[0], to[1] - at[1]), tabs.width, tabs.thickness]}
        color={color}
      />
    </TabMarker>
  ));
}

/**
 * The selected profile's or engraving's start points (#426), each a disc as
 * wide as the tool at the stock top, where the tool centre enters the cut.
 * While the workspace edits them (top view only), a click near one of the
 * operation's paths adds a start point there (at the nearer end of an open
 * path), dragging one moves it along the paths and clicking it removes it.
 */
export function StartPoints({ color }: { color: string }) {
  const selected = useSelectedOperation();
  const operation = selected?.type === "profile" || selected?.type === "engrave" ? selected : null;
  const editing = useWorkspaceStore((s) => s.editing === "startPoints");
  const geometry = useDocumentStore((s) => s.document.geometry);
  const store = useDocumentStoreApi();
  const targets = operation?.targets;
  const side = operation?.params.side;
  const startPoints = operation?.params.startPoints;
  // How far the tool centre is off the closed paths, on the finished cut.
  const offset =
    operation &&
    (operation.type === "profile"
      ? operation.tool.diameter / 2
      : grooveWidth(operation.tool, operation.params.depth) / 2);
  const shapes = useMemo(
    () => targetedShapes(new Map(geometry.map((shape) => [shape.id, shape])), targets ?? []),
    [geometry, targets],
  );
  const paths = useMemo(() => (side ? startPointPaths(shapes, side) : []), [shapes, side]);
  const centres = useMemo(
    () =>
      side && offset !== null && offset !== undefined && startPoints
        ? startPointCentres(shapes, side, offset, startPoints)
        : [],
    [shapes, side, offset, startPoints],
  );
  if (!operation || !startPoints) return null;
  const { depth } = operation.params;
  const radius = operation.tool.diameter / 2;

  function add(event: ThreeEvent<MouseEvent>) {
    if (!operation || event.delta > TAB_DRAG_THRESHOLD) return;
    const point = onStockTop(event.ray);
    const snapped = point && snapStartPoint(paths, point);
    if (snapped && snapped.distance <= TAB_PICK_DISTANCE / event.camera.zoom) {
      addStartPoint(store, operation.id, snapped.point);
    }
  }

  return (
    <>
      {editing && <StockTopCatcher z={-depth - 1} onClick={add} />}
      {centres.map((center, index) => (
        <TabMarker
          // Positions have no ids; a marker keeps its index while dragged.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          frame={{ center, angle: 0 }}
          z={0}
          editing={editing}
          onMove={(point) => {
            const snapped = snapStartPoint(paths, point);
            if (snapped) moveStartPoint(store, operation.id, index, snapped.point);
          }}
          onRemove={() => removeStartPoint(store, operation.id, index)}
        >
          <MarkerMesh color={color}>
            <circleGeometry args={[radius, 32]} />
          </MarkerMesh>
        </TabMarker>
      ))}
    </>
  );
}

/**
 * The selected profile's entry points (#427): a disc as wide as the tool
 * where its centre meets the contour (S) and where it plunges (P), joined by
 * the lead line, at the stock top. While the workspace edits them (top view
 * only), a click near one of the profile's closed paths picks S and the next
 * click anywhere picks P, replacing the entry already on that path; dragging
 * S moves it along the paths, dragging P moves it anywhere, and clicking
 * either removes the entry.
 */
export function Entries({ color }: { color: string }) {
  const selected = useSelectedOperation();
  const operation = selected?.type === "profile" ? selected : null;
  const editing = useWorkspaceStore((s) => s.editing === "entries");
  const geometry = useDocumentStore((s) => s.document.geometry);
  const store = useDocumentStoreApi();
  const [pending, setPending] = useState<{ point: Point; loop: number } | null>(null);
  const targets = operation?.targets;
  const side = operation?.params.side;
  const radius = operation && operation.tool.diameter / 2;
  const entries = operation?.params.entries;
  const shapes = useMemo(
    () => targetedShapes(new Map(geometry.map((shape) => [shape.id, shape])), targets ?? []),
    [geometry, targets],
  );
  const loops = useMemo(() => closedLoops(shapes), [shapes]);
  const centres = useMemo(
    () =>
      side && radius && entries
        ? startPointCentres(
            shapes,
            side,
            radius,
            entries.map(({ start }) => start),
          )
        : [],
    [shapes, side, radius, entries],
  );
  const leads = useMemo(
    () =>
      new Float32Array(
        (entries ?? []).flatMap(({ plunge }, i) => {
          const centre = centres[i] ?? plunge;
          return [plunge[0], plunge[1], 0, centre[0], centre[1], 0];
        }),
      ),
    [entries, centres],
  );
  // Where the tool centre meets the path at the half-picked start, as for the committed ones.
  const pendingCentre = useMemo(
    () =>
      pending && side && radius
        ? (startPointCentres(shapes, side, radius, [pending.point])[0] ?? pending.point)
        : null,
    [pending, shapes, side, radius],
  );
  // A half-picked entry is dropped with its mode or operation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets on either change
  useEffect(() => setPending(null), [editing, operation?.id]);
  if (!operation || !entries || !radius) return null;

  function pick(event: ThreeEvent<MouseEvent>) {
    if (!operation || event.delta > TAB_DRAG_THRESHOLD) return;
    const point = onStockTop(event.ray);
    if (!point) return;
    if (pending) {
      // One entry per path: a new one replaces the entry already on it.
      const replacing = operation.params.entries.findIndex(
        ({ start }) => nearestOnLoops(loops, start)?.loop === pending.loop,
      );
      addEntry(
        store,
        operation.id,
        { start: pending.point, plunge: point },
        replacing < 0 ? null : replacing,
      );
      setPending(null);
      return;
    }
    const nearest = nearestOnLoops(loops, point);
    if (nearest && nearest.distance <= TAB_PICK_DISTANCE / event.camera.zoom) {
      setPending({ point: nearest.point, loop: nearest.loop });
    }
  }

  const disc = <circleGeometry args={[radius, 32]} />;
  return (
    <>
      {editing && <StockTopCatcher z={-operation.params.depth - 1} onClick={pick} />}
      <Lines positions={leads} color={color} renderOrder={RENDER_ORDER.tabs} overlay />
      {pendingCentre && (
        <TabMarker frame={{ center: pendingCentre, angle: 0 }} z={0} editing={false}>
          <MarkerMesh color={color} faded>
            {disc}
          </MarkerMesh>
        </TabMarker>
      )}
      {entries.map((entry, index) => (
        // Entries have no ids; a marker keeps its index while dragged.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <group key={index}>
          <TabMarker
            frame={{ center: centres[index] ?? entry.start, angle: 0 }}
            z={0}
            editing={editing}
            onMove={(point) => {
              const nearest = nearestOnLoops(loops, point);
              // One entry per path: S doesn't go onto a path another entry has.
              const taken = operation.params.entries.some(
                ({ start }, other) =>
                  other !== index && nearestOnLoops(loops, start)?.loop === nearest?.loop,
              );
              if (nearest && !taken) {
                moveEntry(store, operation.id, index, { ...entry, start: nearest.point });
              }
            }}
            onRemove={() => removeEntry(store, operation.id, index)}
          >
            <MarkerMesh color={color}>{disc}</MarkerMesh>
          </TabMarker>
          <TabMarker
            frame={{ center: entry.plunge, angle: 0 }}
            z={0}
            editing={editing}
            onMove={(plunge) => moveEntry(store, operation.id, index, { ...entry, plunge })}
            onRemove={() => removeEntry(store, operation.id, index)}
          >
            <MarkerMesh color={color} faded>
              {disc}
            </MarkerMesh>
          </TabMarker>
        </group>
      ))}
    </>
  );
}

/**
 * The selected drill's placed holes (#429), each a disc as wide as the tool
 * at the stock top. While the workspace places them (top view only), the
 * cursor snaps like the zero picker's, and to segment midpoints and edges;
 * a click adds a hole where shown and clicking a hole removes it.
 */
export function Holes({ color, snapColor }: { color: string; snapColor: string }) {
  const selected = useSelectedOperation();
  const operation = selected?.type === "drill" && !selected.params.pins ? selected : null;
  const editing = useWorkspaceStore((s) => s.editing === "holes");
  const store = useDocumentStoreApi();
  if (!operation) return null;
  const radius = operation.tool.diameter / 2;

  return (
    <>
      {editing && <HolePicker operation={operation} color={snapColor} />}
      {operation.params.points.map((center, index) => (
        <TabMarker
          // Positions have no ids.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          frame={{ center, angle: 0 }}
          z={0}
          editing={editing}
          onRemove={() => removeHole(store, operation.id, index)}
        >
          <MarkerMesh color={color}>
            <circleGeometry args={[radius, 32]} />
          </MarkerMesh>
        </TabMarker>
      ))}
    </>
  );
}

/** The snapping cursor of `Holes`, with a dashed circle the size of the tool. */
function HolePicker({ operation, color }: { operation: DrillOperation; color: string }) {
  const store = useDocumentStoreApi();
  const width = useDocumentStore((s) => s.document.stock.width);
  const height = useDocumentStore((s) => s.document.stock.height);
  const thickness = useDocumentStore((s) => s.document.stock.thickness);
  const geometry = useDocumentStore((s) => s.document.geometry);
  const targets = useMemo(
    () => holeSnapTargets({ width, height }, geometry),
    [width, height, geometry],
  );
  const edges = useMemo(() => snapEdges(geometry), [geometry]);
  const { diameter } = operation.tool;
  const ring = useMemo(() => touchOffLinePositions({ x: 0, y: 0, diameter }), [diameter]);
  const [hover, setHover] = useState<SnapPick | null>(null);
  const hoverHandlers = useStockTopHover((cursor, millimetresPerPixel) => {
    const target =
      cursor && nearestHoleSnap(targets, edges, cursor, SNAP_RADIUS * millimetresPerPixel);
    const next = cursor && { point: target?.point ?? cursor, target };
    setHover((previous) => (samePick(previous, next) ? previous : next));
  });

  return (
    <>
      <StockTopCatcher
        // Below the holes, so a click on one reaches it first and stops here.
        z={-thickness - 1}
        {...hoverHandlers}
        onClick={(event) => {
          if (event.delta > CLICK_THRESHOLD || !hover) return;
          addHole(store, operation.id, hover.point);
        }}
      />
      {hover && (
        <SnapHover pick={hover} color={color}>
          <DashedLines
            positions={ring.ring}
            distances={ring.distances}
            color={color}
            renderOrder={RENDER_ORDER.snap}
            overlay
          />
        </SnapHover>
      )}
    </>
  );
}

/**
 * The selected profile's corner overcuts (#428), each a disc as wide as the
 * tool at the end of the overcut, at the final depth; a left-out one only
 * outlined. While editing them, clicking one leaves it out or puts it back.
 */
export function Overcuts({ color }: { color: string }) {
  const selected = useSelectedOperation();
  const operation =
    selected?.type === "profile" && selected.params.cornerOvercuts ? selected : null;
  const editing = useWorkspaceStore((s) => s.editing === "overcuts");
  const geometry = useDocumentStore((s) => s.document.geometry);
  const store = useDocumentStoreApi();
  const targets = operation?.targets;
  const side = operation?.params.side;
  const radius = operation && operation.tool.diameter / 2;
  const maxAngle = operation?.params.cornerOvercuts?.maxAngle;
  const excluded = operation?.params.cornerOvercuts?.excluded;
  const shapes = useMemo(
    () => targetedShapes(new Map(geometry.map((shape) => [shape.id, shape])), targets ?? []),
    [geometry, targets],
  );
  // Leaving one out only matches the excluded points again, without offsetting the shapes.
  const found = useMemo(
    () =>
      side && radius && maxAngle !== undefined
        ? profileOvercuts(shapes, side, radius, maxAngle)
        : [],
    [shapes, side, radius, maxAngle],
  );
  const overcuts = useMemo(() => excludeOvercuts(found, excluded ?? []), [found, excluded]);
  if (!operation || !radius) return null;

  return overcuts.map(({ ring, vertex, tip, corner, excludedBy }) => (
    <TabMarker
      key={`${ring}:${vertex}`}
      frame={{ center: tip, angle: 0 }}
      z={-operation.params.depth}
      editing={editing}
      onRemove={() =>
        excludedBy.length > 0
          ? restoreOvercut(store, operation.id, excludedBy)
          : excludeOvercut(store, operation.id, corner)
      }
    >
      <MarkerMesh color={color} faded={excludedBy.length > 0}>
        <circleGeometry args={[radius, 32]} />
      </MarkerMesh>
    </TabMarker>
  ));
}

/** A tab's material as a translucent box, `size` along the contour, across it and up. */
function TabBox({ size, color }: { size: Vec3; color: string }) {
  return (
    <MarkerMesh color={color}>
      <boxGeometry args={size} />
    </MarkerMesh>
  );
}

/** A marker's `children` geometry, translucent and outlined, or only outlined when `faded`. */
function MarkerMesh({
  color,
  faded = false,
  children,
}: {
  color: string;
  faded?: boolean;
  children: ReactNode;
}) {
  return (
    // Drawn over the stock and the shapes, which would otherwise hide it from above.
    <mesh renderOrder={RENDER_ORDER.tabs}>
      {children}
      <meshBasicMaterial
        color={color}
        transparent
        opacity={faded ? 0 : 0.35}
        depthTest={false}
        depthWrite={false}
      />
      <Edges color={color} transparent depthTest={false} renderOrder={RENDER_ORDER.tabs} />
    </mesh>
  );
}

/** A press on a marker, which becomes a drag once the pointer moves far enough. */
type TabPress = { pointerId: number; x: number; y: number; dragging: boolean };

/**
 * A tab, start point, overcut or placed hole drawn as `children`, which a drag moves and
 * a click removes while `editing`, showing the grab cursor over it and while
 * dragging, or the pointer one when it can't be dragged.
 */
function TabMarker({
  frame,
  z,
  editing,
  onMove,
  onRemove,
  children,
}: {
  frame: TabFrame;
  /** Height of the marker's middle. */
  z: number;
  editing: boolean;
  /** Without it, the marker can't be dragged. */
  onMove?: (point: Point) => void;
  /** Without it, a click on the marker does nothing. */
  onRemove?: () => void;
  children: ReactNode;
}) {
  const store = useDocumentStoreApi();
  const grab = useRef<Mesh>(null);
  const press = useRef<TabPress | null>(null);

  // A few pixels across whatever the zoom, so a small tab is still easy to grab.
  useFrame(({ camera }) => {
    const radius = "isOrthographicCamera" in camera ? TAB_GRAB_RADIUS / camera.zoom : 0;
    grab.current?.scale.setScalar(Math.max(radius, 1e-6));
  });

  const setMarkerCursor = useWorkspaceStore((s) => s.setMarkerCursor);
  const hovered = useRef(false);

  function showCursor() {
    setMarkerCursor(
      press.current?.dragging
        ? "grabbing"
        : editing && hovered.current
          ? onMove
            ? "grab"
            : "pointer"
          : null,
    );
  }

  // Editing turned off under a still pointer drops the grab cursor; other markers leave it be.
  // biome-ignore lint/correctness/useExhaustiveDependencies: showCursor reads `editing`
  useEffect(() => {
    if (hovered.current || press.current) showCursor();
  }, [editing]);

  // A drag cut short by unmounting (an undo, a deselection) is cancelled.
  useEffect(
    () => () => {
      if (press.current?.dragging) store.getState().cancelTransaction();
      if (hovered.current || press.current) setMarkerCursor(null);
    },
    [store, setMarkerCursor],
  );

  function end(event: ThreeEvent<PointerEvent>, cancelled: boolean) {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    (event.target as Element).releasePointerCapture(event.pointerId);
    press.current = null;
    showCursor();
    if (!current.dragging) return;
    const state = store.getState();
    if (cancelled) state.cancelTransaction();
    else state.commitTransaction();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element
    <group
      position={[frame.center[0], frame.center[1], z]}
      onPointerOver={() => {
        hovered.current = true;
        showCursor();
      }}
      onPointerOut={() => {
        hovered.current = false;
        showCursor();
      }}
      rotation={[0, 0, frame.angle]}
      onPointerDown={(event) => {
        if (!editing || event.button !== 0) return;
        event.stopPropagation();
        (event.target as Element).setPointerCapture(event.pointerId);
        press.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          dragging: false,
        };
      }}
      onPointerMove={(event) => {
        const current = press.current;
        if (!current || current.pointerId !== event.pointerId || !onMove) return;
        event.stopPropagation();
        if (!current.dragging) {
          const travel = Math.hypot(event.clientX - current.x, event.clientY - current.y);
          if (travel < TAB_DRAG_THRESHOLD) return;
          current.dragging = true;
          store.getState().beginTransaction();
          showCursor();
        }
        const point = onStockTop(event.ray);
        if (point) onMove(point);
      }}
      onPointerUp={(event) => end(event, false)}
      onPointerCancel={(event) => end(event, true)}
      onClick={(event) => {
        if (!editing) return;
        // Keeps the click from adding a marker underneath, whether it removes this one or ends a drag.
        event.stopPropagation();
        if (event.delta <= TAB_DRAG_THRESHOLD) onRemove?.();
      }}
    >
      {children}
      <mesh ref={grab}>
        <circleGeometry args={[1, 16]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
