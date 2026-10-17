"use client";

import type { ToolpathLines } from "@furrow/cam-core";
import { clearingTool, type Operation } from "@furrow/document";
import {
  useDocumentStore,
  useToolpathStore,
  useWorkspaceStore,
} from "@/features/workspace/providers/workspace-stores";
import { DashedLines, Lines } from "./lines";
import { usePlaybackProgress } from "./playback";
import { type Palette, RENDER_ORDER } from "./scene-style";

/** Opacity of a toolpath being recomputed, drawn from its last result meanwhile. */
const STALE_OPACITY = 0.35;

/** Opacity of the moves a playback hasn't cut yet (#100). */
const UNCUT_OPACITY = 0.3;

/**
 * The toolpaths of the enabled operations not hidden in the Operations pane
 * (PRD-0001 R9): cutting moves solid in the tool's colour, darker the deeper
 * they go for V-carves, rapids dashed in the palette's. Clearing moves
 * (ADR-0026) are drawn the same way in the clearing tool's colour. Everything drawn is built in the worker (ADR-0008), so even
 * 100k-segment pockets are a handful of draw calls and no work here. In the
 * top view a circle the size of the hole marks each drilled hole, which would
 * otherwise be invisible from above. During a playback (#100), the moves
 * cut so far are drawn as usual and the rest dimmed, through the stock that
 * would otherwise hide them.
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
  const progress = usePlaybackProgress(operation.id, false);
  const clearingProgress = usePlaybackProgress(operation.id, true);
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
          progress={clearingProgress}
        />
      )}
      <ToolpathLinesView
        lines={lines}
        color={operation.tool.color}
        rapidColor={rapidColor}
        opacity={opacity}
        showHoles={showHoles}
        progress={progress}
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
  progress,
}: {
  lines: ToolpathLines;
  color: string;
  rapidColor: string;
  opacity: number;
  showHoles: boolean;
  /** The segments a playback has cut; without it, all are drawn alike. */
  progress?: { feeds: number; rapids: number };
}) {
  const rapids = lines.rapids.length / 6;
  const feeds = lines.feeds.length / 6;
  const cut = progress ?? { feeds, rapids };
  return (
    <>
      <DashedLines
        positions={lines.rapids}
        distances={lines.rapidDistances}
        color={rapidColor}
        renderOrder={RENDER_ORDER.rapids}
        opacity={opacity}
        segments={progress && [0, cut.rapids]}
      />
      <Lines
        positions={lines.feeds}
        colors={lines.feedColors}
        color={color}
        renderOrder={RENDER_ORDER.feeds}
        opacity={opacity}
        segments={progress && [0, cut.feeds]}
      />
      {progress && (
        <>
          <DashedLines
            positions={lines.rapids}
            distances={lines.rapidDistances}
            color={rapidColor}
            renderOrder={RENDER_ORDER.rapids}
            opacity={opacity * UNCUT_OPACITY}
            segments={[cut.rapids, rapids]}
            overlay
          />
          <Lines
            positions={lines.feeds}
            colors={lines.feedColors}
            color={color}
            renderOrder={RENDER_ORDER.feeds}
            opacity={opacity * UNCUT_OPACITY}
            segments={[cut.feeds, feeds]}
            overlay
          />
        </>
      )}
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
