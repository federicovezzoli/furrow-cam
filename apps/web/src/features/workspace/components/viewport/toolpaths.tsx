"use client";

import type { ToolpathLines } from "@furrow/cam-core";
import { clearingTool, type Operation } from "@furrow/document";
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
 * (PRD-0001 R9): cutting moves solid in the tool's colour, darker the deeper
 * they go for V-carves, rapids dashed in the palette's. Clearing moves
 * (ADR-0026) are drawn the same way in the clearing tool's colour. Everything drawn is built in the worker (ADR-0008), so even
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
  const clearing = clearingTool(operation);
  return (
    <>
      {clearing && entry.status !== "error" && entry.clearing && (
        <ToolpathLinesView
          lines={entry.clearing}
          color={clearing.color}
          rapidColor={rapidColor}
          opacity={opacity}
          showHoles={false}
        />
      )}
      <ToolpathLinesView
        lines={lines}
        color={operation.tool.color}
        rapidColor={rapidColor}
        opacity={opacity}
        showHoles={showHoles}
      />
    </>
  );
}

function ToolpathLinesView({
  lines,
  color,
  rapidColor,
  opacity,
  showHoles,
}: {
  lines: ToolpathLines;
  color: string;
  rapidColor: string;
  opacity: number;
  showHoles: boolean;
}) {
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
        colors={lines.feedColors}
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
