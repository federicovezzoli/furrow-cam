"use client";

import { stockBox, xyOriginPosition } from "@furrow/cam-core";
import { Canvas, useThree } from "@react-three/fiber";
import { BoxIcon, LayersIcon, RouteIcon, RouteOffIcon, ScanIcon, SquareIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSimulation } from "@/features/workspace/hooks/use-simulation";
import { belongsElsewhere } from "@/features/workspace/lib/keyboard-target";
import { heightmapCellLimit } from "@/features/workspace/lib/simulation-mesh";
import { boxWithPoint } from "@/features/workspace/lib/viewport-scene";
import {
  useDocumentStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/features/workspace/providers/workspace-stores";
import type { ViewMode } from "@/features/workspace/stores/workspace-store";
import { cn } from "@/lib/utils";
import { type CameraPoses, OrbitCamera, TopCamera } from "./cameras";
import { Scene } from "./scene";
import { PALETTES } from "./scene-style";

/**
 * The workspace's 3D viewport (ADR-0008): stock, grid, work origin, geometry
 * and toolpaths (or the stock as simulated after cutting, ADR-0019) in one scene, seen from an orthographic top view or a perspective
 * orbit view. The scene is in stock coordinates (millimetres, Z up, ADR-0014):
 * the stock stays put, and changing the work origin moves the origin marker
 * and the grid, and the drawing when an anchor is chosen (ADR-0022).
 * Browser-only: load it with `next/dynamic` and `ssr: false`.
 */
export function Viewport() {
  const view = useWorkspaceStore((s) => s.view);
  const editingTabs = useWorkspaceStore((s) => s.editingTabs);
  const pickingZero = useWorkspaceStore((s) => s.pickingZero);
  const simulating = useWorkspaceStore((s) => s.simulating);
  // Known once the renderer is up, inside the canvas.
  const [maxTextureSize, setMaxTextureSize] = useState<number | null>(null);
  const simulation = useSimulation(
    simulating && maxTextureSize !== null ? heightmapCellLimit(maxTextureSize) : null,
  );
  const overPath = useWorkspaceStore((s) => s.hovered !== null);
  const cancelPick = useCancelZeroPick(pickingZero);
  const { resolvedTheme } = useTheme();
  const palette = PALETTES[resolvedTheme === "dark" ? "dark" : "light"];
  const stock = useDocumentStore((s) => s.document.stock);
  const { width, height, thickness } = stock;
  const box = useMemo(() => stockBox({ width, height, thickness }), [width, height, thickness]);
  // The cameras fit the stock and the zero, which may lie outside it (ADR-0016).
  const fitBox = useMemo(() => boxWithPoint(box, [...xyOriginPosition(stock), 0]), [box, stock]);
  // Pressing Fit or resizing the stock fits the camera again: new keys remount
  // the cameras, which then find no saved pose.
  const [fits, setFits] = useState(0);
  const poseKey = `${view}:${fits}:${width}x${height}x${thickness}`;
  const [poses] = useState<CameraPoses>(() => new Map());
  // A simulation of the stock before a resize would sit at the old size and depth.
  const sim = simulation.stock;
  const heightmap =
    simulating &&
    sim !== null &&
    sim.width === width &&
    sim.height === height &&
    sim.thickness === thickness
      ? simulation.heightmap
      : null;
  const status = simulating ? simulationStatus(simulation) : [];

  return (
    <div
      className={cn(
        "relative h-full",
        editingTabs || pickingZero ? "cursor-crosshair" : overPath && "cursor-pointer",
      )}
      {...cancelPick}
    >
      <Canvas frameloop="demand" dpr={[1, 2]} aria-label="Stock, geometry and toolpaths">
        {view === "top" ? (
          <TopCamera key={poseKey} box={fitBox} poses={poses} poseKey={poseKey} />
        ) : (
          <OrbitCamera key={poseKey} box={fitBox} poses={poses} poseKey={poseKey} />
        )}
        <Scene box={box} palette={palette} heightmap={heightmap} />
        <TextureLimit onLimit={setMaxTextureSize} />
      </Canvas>
      <ViewToolbar view={view} onFit={() => setFits((n) => n + 1)} />
      {status.length > 0 && (
        <div
          role="status"
          className="absolute bottom-2 left-2 space-y-0.5 rounded-md border bg-background/90 px-2 py-1 text-muted-foreground text-xs shadow-xs"
        >
          {status.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the simulation is doing, and what it leaves out, one line each. */
function simulationStatus({
  pending,
  error,
  skipped,
}: {
  pending: boolean;
  error: string | null;
  skipped: string[];
}): string[] {
  const lines: string[] = [];
  if (pending) lines.push("Simulating…");
  else if (error) lines.push(`Simulation failed: ${error}`);
  if (skipped.length > 0) lines.push(`Not simulated, toolpath failed: ${skipped.join(", ")}`);
  return lines;
}

/** Reports the tallest texture the viewport's renderer supports, which caps the heightmap. */
function TextureLimit({ onLimit }: { onLimit: (maxTextureSize: number) => void }) {
  const maxTextureSize = useThree((s) => s.gl.capabilities.maxTextureSize);
  useEffect(() => onLimit(maxTextureSize), [maxTextureSize, onLimit]);
  return null;
}

/** Pointer travel, in pixels, past which a right-button press pans rather than clicks. */
const RIGHT_CLICK_THRESHOLD = 3;

/**
 * Esc or a right-click ends picking the zero. The right button also pans the
 * top view, so only a press released where it started counts as a click.
 * Returns the viewport's pointer handlers, which see presses before the
 * camera controls do.
 */
function useCancelZeroPick(picking: boolean) {
  const workspace = useWorkspaceStoreApi();
  const press = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!picking) return;
    function onKeyDown(event: KeyboardEvent) {
      // A focused field may use Esc itself, e.g. to cancel a gesture.
      if (event.key !== "Escape" || event.defaultPrevented || belongsElsewhere(event.target)) {
        return;
      }
      workspace.getState().setPickingZero(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picking, workspace]);

  return {
    onPointerDownCapture(event: React.PointerEvent) {
      press.current = picking && event.button === 2 ? { x: event.clientX, y: event.clientY } : null;
    },
    onPointerUpCapture(event: React.PointerEvent) {
      const start = press.current;
      press.current = null;
      if (!picking || !start || event.button !== 2) return;
      const travel = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (travel <= RIGHT_CLICK_THRESHOLD) workspace.getState().setPickingZero(false);
    },
  };
}

const VIEWS: { value: ViewMode; label: string; Icon: typeof SquareIcon; hint: string }[] = [
  {
    value: "top",
    label: "Top view",
    Icon: SquareIcon,
    hint: "Drag with the right or middle button to pan, scroll to zoom",
  },
  {
    value: "orbit",
    label: "3D view",
    Icon: BoxIcon,
    hint: "Drag to orbit, right-drag to pan, scroll to zoom",
  },
];

function ViewToolbar({ view, onFit }: { view: ViewMode; onFit: () => void }) {
  const setView = useWorkspaceStore((s) => s.setView);
  return (
    <div className="absolute top-2 left-2 flex items-center gap-2">
      <div role="toolbar" aria-label="View" className={TOOLBAR_GROUP}>
        {VIEWS.map(({ value, label, Icon, hint }) => (
          <Button
            key={value}
            variant={view === value ? "secondary" : "ghost"}
            size="icon-compact"
            aria-label={label}
            aria-pressed={view === value}
            title={`${label}: ${hint}`}
            onClick={() => setView(value)}
          >
            <Icon />
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label="Fit stock"
          title="Fit stock"
          onClick={onFit}
        >
          <ScanIcon />
        </Button>
      </div>
      <CutToolbar />
    </div>
  );
}

const TOOLBAR_GROUP =
  "flex items-center gap-0.5 rounded-md border bg-background/90 p-0.5 shadow-xs";

/**
 * What the viewport shows of the cut: the toolpaths of the enabled operations,
 * all shown or hidden at once (the Operations pane does it per operation),
 * and the simulated stock.
 */
function CutToolbar() {
  const workspace = useWorkspaceStoreApi();
  const simulating = useWorkspaceStore((s) => s.simulating);
  const operations = useDocumentStore((s) => s.document.operations);
  const operationIds = useMemo(
    () => operations.filter((op) => op.enabled).map((op) => op.id),
    [operations],
  );
  const anyShown = useWorkspaceStore((s) =>
    operationIds.some((id) => !s.hiddenToolpathIds.includes(id)),
  );
  const ToolpathsIcon = anyShown ? RouteIcon : RouteOffIcon;
  return (
    <div role="toolbar" aria-label="Cut" className={TOOLBAR_GROUP}>
      <Button
        variant={anyShown ? "secondary" : "ghost"}
        size="icon-compact"
        aria-label="Show toolpaths"
        aria-pressed={anyShown}
        title={anyShown ? "Hide all toolpaths" : "Show all toolpaths"}
        disabled={operationIds.length === 0}
        onClick={() => workspace.getState().setToolpathsVisible(operationIds, !anyShown)}
      >
        <ToolpathsIcon />
      </Button>
      <Button
        variant={simulating ? "secondary" : "ghost"}
        size="icon-compact"
        aria-label="Simulate cutting"
        aria-pressed={simulating}
        title="Simulate cutting: show the stock as it will look after the toolpaths"
        onClick={() => workspace.getState().setSimulating(!simulating)}
      >
        <LayersIcon />
      </Button>
    </div>
  );
}
