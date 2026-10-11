"use client";

import { nearestSnapTarget, type SnapTarget, snapTargets } from "@furrow/cam-core";
import type { Point } from "@furrow/document";
import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { pointLabel, snapLabel } from "@/lib/snap-label";
import { pickXYOrigin } from "@/stores/stock-actions";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/stores/workspace-stores";
import { RENDER_ORDER } from "./scene-style";
import { onStockTop } from "./stock-top";

/** How near to a snap target, in pixels, the cursor snaps to it, however far zoomed. */
const SNAP_RADIUS = 10;
/** Radius in pixels of the ring drawn on the snap target. */
const SNAP_MARKER_RADIUS = 6;
/** Pointer travel, in pixels, past which a press is a drag rather than a click. */
const CLICK_THRESHOLD = 3;

/** Where a click would put the zero: on a snap target, or on the cursor (`target` null). */
type Pick = { point: Point; target: SnapTarget | null };

/**
 * Picking the XY zero in the viewport (PRD-0002 Z5), while the workspace is
 * in that mode (top view only). The cursor snaps to the nearest target within
 * `SNAP_RADIUS` pixels, computed from the document's geometry (ADR-0008), not
 * by raycasting; the target is ringed and labelled with its kind and position.
 * A click sets a custom zero there as one undo step and ends the mode; the
 * viewport cancels it on Esc or a right-click.
 */
export function ZeroPick({ color }: { color: string }) {
  const picking = useWorkspaceStore((s) => s.pickingZero);
  return picking ? <ZeroPicker color={color} /> : null;
}

function ZeroPicker({ color }: { color: string }) {
  const workspace = useWorkspaceStoreApi();
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const width = useDocumentStore((s) => s.document.stock.width);
  const height = useDocumentStore((s) => s.document.stock.height);
  const thickness = useDocumentStore((s) => s.document.stock.thickness);
  const geometry = useDocumentStore((s) => s.document.geometry);
  // Gathered once per stock size and geometry, not on every pointer move.
  const targets = useMemo(
    () => snapTargets({ width, height }, geometry),
    [width, height, geometry],
  );
  const [hover, setHover] = useState<Pick | null>(null);

  function pickAt(event: ThreeEvent<PointerEvent | MouseEvent>): Pick | null {
    const cursor = onStockTop(event.ray);
    if (!cursor) return null;
    // The top view is orthographic: its zoom is in pixels per millimetre.
    const target = nearestSnapTarget(targets, cursor, SNAP_RADIUS / event.camera.zoom);
    return { point: target?.point ?? cursor, target };
  }

  return (
    <>
      {/* Catches the pointer anywhere; where it is, is measured on the stock top. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element */}
      <mesh
        position={[0, 0, -thickness - 1]}
        onPointerMove={(event) => setHover(pickAt(event))}
        onPointerOut={() => setHover(null)}
        onClick={(event) => {
          if (event.delta > CLICK_THRESHOLD) return;
          const pick = pickAt(event);
          if (!pick) return;
          pickXYOrigin(store, pick.point);
          workspace.getState().setPickingZero(false);
        }}
      >
        <planeGeometry args={[100_000, 100_000]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {hover && (
        <group position={[hover.point[0], hover.point[1], 0]}>
          {hover.target && <SnapMarker color={color} />}
          <Html style={{ pointerEvents: "none" }}>
            <div className="ml-3 -translate-y-full rounded-md border bg-popover px-1.5 py-0.5 text-popover-foreground text-xs whitespace-nowrap shadow-xs">
              <div className="font-medium">{snapLabel(hover.target)}</div>
              <div className="tabular-nums">{pointLabel(hover.point, units)}</div>
            </div>
          </Html>
        </group>
      )}
    </>
  );
}

/** A ring a few pixels across whatever the zoom, drawn over everything. */
function SnapMarker({ color }: { color: string }) {
  const ring = useRef<Group>(null);
  useFrame(({ camera }) => {
    ring.current?.scale.setScalar(SNAP_MARKER_RADIUS / camera.zoom);
  });
  return (
    <group ref={ring}>
      <mesh renderOrder={RENDER_ORDER.snap}>
        <ringGeometry args={[0.6, 1, 32]} />
        <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
