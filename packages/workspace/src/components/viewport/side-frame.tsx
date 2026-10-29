"use client";

import { flipTransform } from "@furrow/cam-core";
import type { StockSide } from "@furrow/document";
import type * as React from "react";
import { useMemo } from "react";
import { Matrix4 } from "three";
import { useShallow } from "zustand/react/shallow";
import { useDocumentStore, useWorkspaceStore } from "../../providers/workspace-stores";

/**
 * Draws `children`, which are in `side`'s stock coordinates, as the side in
 * view sees them (ADR-0060): turned over through the flip when the sides
 * differ, as they are otherwise. The drawing, the models and the tabs are in
 * the top side's coordinates; each toolpath is in its operation's side's.
 */
export function SideFrame({ side, children }: { side: StockSide; children: React.ReactNode }) {
  const matrix = useSideMatrix(side);
  if (!matrix) return children;
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      {children}
    </group>
  );
}

/** The matrix that turns `side`'s stock coordinates into those of the side in view, or `null` for none. */
function useSideMatrix(side: StockSide): Matrix4 | null {
  // Only what the flip depends on, so moving the zero or the pad redraws no toolpath.
  const { width, height, thickness, flipAxis } = useDocumentStore(
    useShallow(({ document: { stock } }) => ({
      width: stock.width,
      height: stock.height,
      thickness: stock.thickness,
      flipAxis: stock.twoSided?.flipAxis,
    })),
  );
  const inView = useWorkspaceStore((s) => s.side);
  return useMemo(() => {
    if (side === inView || !flipAxis) return null;
    const affine = flipTransform({ width, height, thickness }, flipAxis);
    // The 3 × 4 affine as the top rows of a 4 × 4 matrix, row by row.
    return new Matrix4().set(...([...affine, 0, 0, 0, 1] as Parameters<Matrix4["set"]>));
  }, [side, inView, width, height, thickness, flipAxis]);
}
