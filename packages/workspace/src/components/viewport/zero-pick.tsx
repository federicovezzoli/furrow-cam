"use client";

import { nearestSnapTarget, type SnapTarget, snapTargets } from "@furrow/cam-core";
import type { Point } from "@furrow/document";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { useLocale, useTranslations } from "use-intl";
import { pointLabel, snapKey } from "../../lib/snap-label";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../../providers/workspace-stores";
import { pickXYOrigin, setXYAnchor } from "../../stores/stock-actions";
import { RENDER_ORDER } from "./scene-style";
import { StockTopCatcher, useStockTopHover } from "./stock-top";

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
 * by raycasting; the target is ringed and labelled with its kind and position,
 * and follows the camera as it pans and zooms under a still cursor. A click
 * puts the zero where shown, as one undo step, and ends the mode: on the
 * anchor itself for a stock anchor, so it follows the stock (Z3), otherwise
 * on a custom zero. The viewport cancels the mode on Esc or a right-click.
 */
export function ZeroPick({ color }: { color: string }) {
  const picking = useWorkspaceStore((s) => s.pickingZero);
  return picking ? <ZeroPicker color={color} /> : null;
}

function ZeroPicker({ color }: { color: string }) {
  const t = useTranslations("Snap");
  const locale = useLocale();
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
  // Shows what a click would pick, re-rendering only when that changes.
  const hoverHandlers = useStockTopHover((cursor, millimetresPerPixel) => {
    const target = cursor && nearestSnapTarget(targets, cursor, SNAP_RADIUS * millimetresPerPixel);
    const next = cursor && { point: target?.point ?? cursor, target };
    setHover((previous) => (samePick(previous, next) ? previous : next));
  });

  return (
    <>
      <StockTopCatcher
        z={-thickness - 1}
        {...hoverHandlers}
        onClick={(event) => {
          if (event.delta > CLICK_THRESHOLD || !hover) return;
          if (hover.target?.kind === "stock_anchor") setXYAnchor(store, hover.target.anchor);
          else pickXYOrigin(store, hover.point);
          workspace.getState().setPickingZero(false);
        }}
      />
      {hover && (
        <group position={[hover.point[0], hover.point[1], 0]}>
          {hover.target && <SnapMarker color={color} />}
          <Html style={{ pointerEvents: "none" }}>
            <div className="ml-3 -translate-y-full rounded-md border bg-popover px-1.5 py-0.5 text-popover-foreground text-xs whitespace-nowrap shadow-xs">
              <div className="font-medium">{t(snapKey(hover.target))}</div>
              <div className="tabular-nums">{pointLabel(hover.point, units, locale)}</div>
            </div>
          </Html>
        </group>
      )}
    </>
  );
}

function samePick(a: Pick | null, b: Pick | null): boolean {
  if (!a || !b) return a === b;
  return a.target === b.target && a.point[0] === b.point[0] && a.point[1] === b.point[1];
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
