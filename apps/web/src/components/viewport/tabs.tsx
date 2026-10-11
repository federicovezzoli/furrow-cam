"use client";

import { closedLoops, nearestOnLoops, type TabFrame, tabFrame, type Vec3 } from "@furrow/cam-core";
import type { Point, ProfileOperation } from "@furrow/document";
import { Edges } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type Mesh, Plane, type Ray, Vector3 } from "three";
import { addTab, moveTab, removeTab } from "@/stores/operation-actions";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "@/stores/workspace-stores";
import { RENDER_ORDER } from "./scene-style";

/** Radius in pixels of the area around a tab that grabs it, however far zoomed out. */
const TAB_GRAB_RADIUS = 6;
/** How near to a contour, in pixels, a click adds a tab. */
const TAB_PICK_DISTANCE = 10;
/** Pointer travel, in pixels, before a press on a tab becomes a drag rather than a click. */
const TAB_DRAG_THRESHOLD = 3;

const STOCK_TOP = new Plane(new Vector3(0, 0, 1), 0);

/** Where `ray` meets the stock top. */
function onStockTop(ray: Ray): Point | null {
  const hit = ray.intersectPlane(STOCK_TOP, new Vector3());
  return hit ? [hit.x, hit.y] : null;
}

/** The selected profile, if it has tabs. */
function useSelectedTabbedProfile(): ProfileOperation | null {
  const id = useWorkspaceStore((s) => s.selectedOperationId);
  const operation = useDocumentStore((s) =>
    s.document.operations.find((candidate) => candidate.id === id),
  );
  return operation?.type === "profile" && operation.params.tabs ? operation : null;
}

/**
 * The selected profile's tabs, drawn as the material they leave: a box the
 * tab's width along the contour, the tool's slot across and the tab's height
 * up from the final depth. While the workspace edits them (top view only), a
 * click near one of the profile's contours adds a tab there, dragging a tab
 * moves it along the contours and clicking it removes it.
 */
export function Tabs({ color }: { color: string }) {
  const operation = useSelectedTabbedProfile();
  const editing = useWorkspaceStore((s) => s.editingTabs);
  const geometry = useDocumentStore((s) => s.document.geometry);
  const store = useDocumentStoreApi();
  const shapeIds = operation?.shapeIds;
  const shapes = useMemo(() => {
    const ids = new Set(shapeIds);
    return geometry.filter((shape) => ids.has(shape.id));
  }, [geometry, shapeIds]);
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
        // Catches clicks anywhere. Below the tabs, so a click on one reaches it first
        // and stops here; where the click lands is measured on the stock top.
        // biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element
        <mesh position={[0, 0, -depth - 1]} onClick={add}>
          <planeGeometry args={[100_000, 100_000]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
      {frames.map((frame, index) => (
        <TabMarker
          // Positions have no ids; a marker keeps its index while dragged.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          frame={frame ?? { center: tabs.positions[index] as Point, angle: 0 }}
          size={[tabs.width, operation.tool.diameter, height]}
          bottom={-depth}
          color={color}
          editing={editing}
          onMove={(point) => {
            const nearest = nearestOnLoops(loops, point);
            if (nearest) moveTab(store, operation.id, index, nearest.point);
          }}
          onRemove={() => removeTab(store, operation.id, index)}
        />
      ))}
    </>
  );
}

/** A press on a tab marker, which becomes a drag once the pointer moves far enough. */
type TabPress = { pointerId: number; x: number; y: number; dragging: boolean };

function TabMarker({
  frame,
  size,
  bottom,
  color,
  editing,
  onMove,
  onRemove,
}: {
  frame: TabFrame;
  /** Along the contour, across it and up. */
  size: Vec3;
  /** Height of the tab's base, the profile's final depth. */
  bottom: number;
  color: string;
  editing: boolean;
  onMove: (point: Point) => void;
  onRemove: () => void;
}) {
  const store = useDocumentStoreApi();
  const grab = useRef<Mesh>(null);
  const press = useRef<TabPress | null>(null);

  // A few pixels across whatever the zoom, so a small tab is still easy to grab.
  useFrame(({ camera }) => {
    const radius = "isOrthographicCamera" in camera ? TAB_GRAB_RADIUS / camera.zoom : 0;
    grab.current?.scale.setScalar(Math.max(radius, 1e-6));
  });

  // A drag cut short by unmounting (an undo, a deselection) is cancelled.
  useEffect(
    () => () => {
      if (press.current?.dragging) store.getState().cancelTransaction();
    },
    [store],
  );

  function end(event: ThreeEvent<PointerEvent>, cancelled: boolean) {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    (event.target as Element).releasePointerCapture(event.pointerId);
    press.current = null;
    if (!current.dragging) return;
    const state = store.getState();
    if (cancelled) state.cancelTransaction();
    else state.commitTransaction();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element
    <group
      position={[frame.center[0], frame.center[1], bottom + size[2] / 2]}
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
        if (!current || current.pointerId !== event.pointerId) return;
        event.stopPropagation();
        if (!current.dragging) {
          const travel = Math.hypot(event.clientX - current.x, event.clientY - current.y);
          if (travel < TAB_DRAG_THRESHOLD) return;
          current.dragging = true;
          store.getState().beginTransaction();
        }
        const point = onStockTop(event.ray);
        if (point) onMove(point);
      }}
      onPointerUp={(event) => end(event, false)}
      onPointerCancel={(event) => end(event, true)}
      onClick={(event) => {
        if (!editing) return;
        // Keeps the click from adding a tab underneath, whether it removes this one or ends a drag.
        event.stopPropagation();
        if (event.delta <= TAB_DRAG_THRESHOLD) onRemove();
      }}
    >
      {/* Drawn over the stock and the shapes, which would otherwise hide it from above. */}
      <mesh renderOrder={RENDER_ORDER.tabs}>
        <boxGeometry args={size} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.35}
          depthTest={false}
          depthWrite={false}
        />
        <Edges color={color} transparent depthTest={false} renderOrder={RENDER_ORDER.tabs} />
      </mesh>
      <mesh ref={grab}>
        <circleGeometry args={[1, 16]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
