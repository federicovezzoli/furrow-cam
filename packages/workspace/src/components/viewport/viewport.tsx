"use client";

import { stockBox, xyOriginPosition } from "@furrow/cam-core";
import { Button } from "@furrow/ui/components/ui/button";
import { cn } from "@furrow/ui/lib/utils";
import { Canvas, useThree } from "@react-three/fiber";
import { BoxIcon, LayersIcon, RouteIcon, RouteOffIcon, ScanIcon, SquareIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useModelPreviews } from "../../hooks/use-model-previews";
import { useSimulation } from "../../hooks/use-simulation";
import { belongsElsewhere } from "../../lib/keyboard-target";
import { heightmapCellLimit } from "../../lib/simulation-mesh";
import { boxWithPoint } from "../../lib/viewport-scene";
import {
  useDocumentStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../../providers/workspace-stores";
import type { ViewMode } from "../../stores/workspace-store";
import { type CameraPoses, OrbitCamera, TopCamera } from "./cameras";
import { ReportCapture } from "./report-capture";
import { Scene } from "./scene";
import { PALETTES } from "./scene-style";

/**
 * The workspace's 3D viewport (ADR-0008): stock, grid, work origin, geometry,
 * 3D models (PRD-0005 S3) and toolpaths (or the stock as simulated after cutting, ADR-0019) in one scene, seen from an orthographic top view or a perspective
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
  const modelPreviews = useModelPreviews();
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
  const t = useTranslations("Viewport");
  const status = simulating ? simulationStatus(t, simulation) : [];

  return (
    <div
      className={cn(
        "relative h-full",
        editingTabs || pickingZero ? "cursor-crosshair" : overPath && "cursor-pointer",
      )}
      {...cancelPick}
    >
      <Canvas frameloop="demand" dpr={[1, 2]} aria-label={t("scene")}>
        <ReportCapture />
        {view === "top" ? (
          <TopCamera key={poseKey} box={fitBox} poses={poses} poseKey={poseKey} />
        ) : (
          <OrbitCamera key={poseKey} box={fitBox} poses={poses} poseKey={poseKey} />
        )}
        <Scene box={box} palette={palette} heightmap={heightmap} modelPreviews={modelPreviews} />
        <TextureLimit onLimit={setMaxTextureSize} />
      </Canvas>
      <ViewToolbar view={view} onFit={() => setFits((n) => n + 1)} />
      {status.length > 0 && (
        <div
          role="status"
          className="absolute bottom-2 left-2 space-y-0.5 rounded-md border bg-background/85 px-2 py-1 text-muted-foreground text-xs shadow-xs backdrop-blur-md"
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
export function simulationStatus(
  t: ReturnType<typeof useTranslations<"Viewport">>,
  {
    pending,
    error,
    skipped,
  }: {
    pending: boolean;
    error: string | null;
    skipped: string[];
  },
): string[] {
  const lines: string[] = [];
  if (pending) lines.push(t("simulating"));
  else if (error) lines.push(t("simulationFailed", { error }));
  if (skipped.length > 0) lines.push(t("notSimulated", { operations: skipped.join(", ") }));
  return lines;
}

/** Reports the tallest texture the viewport's renderer supports, which caps the heightmap. */
export function TextureLimit({ onLimit }: { onLimit: (maxTextureSize: number) => void }) {
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

const VIEWS: { value: ViewMode; Icon: typeof SquareIcon }[] = [
  { value: "top", Icon: SquareIcon },
  { value: "orbit", Icon: BoxIcon },
];

function ViewToolbar({ view, onFit }: { view: ViewMode; onFit: () => void }) {
  return (
    <div className="absolute top-2 left-2 flex items-center gap-2">
      <ViewButtons view={view} onFit={onFit} />
      <CutToolbar />
    </div>
  );
}

/** Top and 3D view, and fitting the stock in view. */
export function ViewButtons({ view, onFit }: { view: ViewMode; onFit: () => void }) {
  const setView = useWorkspaceStore((s) => s.setView);
  const t = useTranslations("Viewport");
  return (
    <div role="toolbar" aria-label={t("view")} className={TOOLBAR_GROUP}>
      {VIEWS.map(({ value, Icon }) => (
        <Button
          key={value}
          variant={view === value ? "secondary" : "ghost"}
          size="icon-compact"
          aria-label={t(`views.${value}`)}
          aria-pressed={view === value}
          title={t("viewHint", { view: t(`views.${value}`), hint: t(`viewHints.${value}`) })}
          onClick={() => setView(value)}
        >
          <Icon />
        </Button>
      ))}
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={t("fitStock")}
        title={t("fitStock")}
        onClick={onFit}
      >
        <ScanIcon />
      </Button>
    </div>
  );
}

export const TOOLBAR_GROUP =
  "flex items-center gap-0.5 rounded-md border bg-background/85 p-0.5 shadow-xs backdrop-blur-md";

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
  const t = useTranslations("Viewport");
  return (
    <div role="toolbar" aria-label={t("cut")} className={TOOLBAR_GROUP}>
      <Button
        variant={anyShown ? "secondary" : "ghost"}
        size="icon-compact"
        aria-label={t("showToolpaths")}
        aria-pressed={anyShown}
        title={anyShown ? t("hideAll") : t("showAll")}
        disabled={operationIds.length === 0}
        onClick={() => workspace.getState().setToolpathsVisible(operationIds, !anyShown)}
      >
        <ToolpathsIcon />
      </Button>
      <Button
        variant={simulating ? "secondary" : "ghost"}
        size="icon-compact"
        aria-label={t("simulate")}
        aria-pressed={simulating}
        title={t("simulateTitle")}
        onClick={() => workspace.getState().setSimulating(!simulating)}
      >
        <LayersIcon />
      </Button>
    </div>
  );
}
