"use client";

import type { Operation } from "@furrow/document";
import {
  useDocumentStore,
  useToolpathStore,
  useWorkspaceStore,
} from "@/features/workspace/providers/workspace-stores";
import { DashedLines, Lines } from "./lines";
import { type Palette, RENDER_ORDER } from "./scene-style";

/** Opacity of a toolpath being recomputed, drawn from its last result meanwhile. */
const STALE_OPACITY = 0.35;

/**
 * The toolpaths of the enabled operations not hidden in the Operations pane
 * (PRD-0001 R9): cutting moves solid in the tool's colour, rapids dashed in
 * the palette's. Everything drawn is built in the worker (ADR-0008), so even
 * 100k-segment pockets are a handful of draw calls and no work here. In the
 * top view a circle the size of the hole marks each drilled hole, which would
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
        showHoles={topView}
      />
    ));
}

function OperationToolpath({
  operation,
  rapidColor,
  showHoles,
}: {
  operation: Operation;
  rapidColor: string;
  showHoles: boolean;
}) {
  const entry = useToolpathStore((s) => s.entries[operation.id]);
  const lines = entry && entry.status !== "error" ? entry.lines : undefined;
  if (!entry || !lines) return null;
  const opacity = entry.status === "ready" ? 1 : STALE_OPACITY;
  const { color } = operation.tool;
  return (
    <>
      <DashedLines
        positions={lines.rapids}
        distances={lines.rapidDistances}
        color={rapidColor}
        renderOrder={RENDER_ORDER.rapids}
        opacity={opacity}
      />
      <Lines
        positions={lines.feeds}
        color={color}
        renderOrder={RENDER_ORDER.feeds}
        opacity={opacity}
      />
      {showHoles && (
        <Lines
          positions={lines.holes}
          color={color}
          renderOrder={RENDER_ORDER.holes}
          opacity={opacity}
        />
      )}
    </>
  );
}
