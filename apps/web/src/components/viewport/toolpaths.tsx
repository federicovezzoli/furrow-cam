"use client";

import type { Operation } from "@furrow/document";
import { useMemo } from "react";
import { plungeMarkerPositions } from "@/lib/viewport-scene";
import { useDocumentStore, useToolpathStore, useWorkspaceStore } from "@/stores/workspace-stores";
import { Lines } from "./lines";
import { type Palette, RENDER_ORDER } from "./scene-style";

/** Opacity of a toolpath being recomputed, drawn from its last result meanwhile. */
const STALE_OPACITY = 0.35;

/**
 * The toolpaths of the enabled operations not hidden in the Operations pane
 * (PRD-0001 R9): cutting moves solid in the tool's colour, rapids dashed in
 * the palette's. Each is a few `LineSegments` built in the worker (ADR-0008),
 * so even 100k-segment pockets are a handful of draw calls. In the top view a
 * circle the size of the tool marks each straight plunge, which would
 * otherwise be invisible from above.
 */
export function Toolpaths({ palette }: { palette: Palette }) {
  const operations = useDocumentStore((s) => s.document.operations);
  const hidden = useWorkspaceStore((s) => s.hiddenToolpathIds);
  const topView = useWorkspaceStore((s) => s.view === "top");
  return operations
    .filter((operation) => operation.enabled && !hidden.includes(operation.id))
    .map((operation) => (
      <OperationToolpath
        key={operation.id}
        operation={operation}
        rapidColor={palette.rapid}
        showPlunges={topView}
      />
    ));
}

function OperationToolpath({
  operation,
  rapidColor,
  showPlunges,
}: {
  operation: Operation;
  rapidColor: string;
  showPlunges: boolean;
}) {
  const entry = useToolpathStore((s) => s.entries[operation.id]);
  const lines = entry && entry.status !== "error" ? entry.lines : undefined;
  if (!entry || !lines) return null;
  const opacity = entry.status === "ready" ? 1 : STALE_OPACITY;
  const { color, diameter } = operation.tool;
  return (
    <>
      <Lines
        positions={lines.rapids}
        color={rapidColor}
        renderOrder={RENDER_ORDER.rapids}
        opacity={opacity}
        dashed
      />
      <Lines
        positions={lines.feeds}
        color={color}
        renderOrder={RENDER_ORDER.feeds}
        opacity={opacity}
      />
      {showPlunges && (
        <PlungeMarkers
          plunges={lines.plunges}
          radius={diameter / 2}
          color={color}
          opacity={opacity}
        />
      )}
    </>
  );
}

function PlungeMarkers({
  plunges,
  radius,
  color,
  opacity,
}: {
  plunges: Float32Array;
  radius: number;
  color: string;
  opacity: number;
}) {
  const positions = useMemo(() => plungeMarkerPositions(plunges, radius), [plunges, radius]);
  return (
    <Lines
      positions={positions}
      color={color}
      renderOrder={RENDER_ORDER.plunges}
      opacity={opacity}
    />
  );
}
