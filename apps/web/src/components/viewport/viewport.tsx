"use client";

import { stockBox, xyOriginPosition } from "@furrow/cam-core";
import { Canvas } from "@react-three/fiber";
import { cn } from "cn";
import { BoxIcon, ScanIcon, SquareIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { belongsElsewhere } from "@/lib/keyboard-target";
import { boxWithPoint } from "@/lib/viewport-scene";
import type { ViewMode } from "@/stores/workspace-store";
import {
  useDocumentStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/stores/workspace-stores";
import { type CameraPoses, OrbitCamera, TopCamera } from "./cameras";
import { Scene } from "./scene";
import { PALETTES } from "./scene-style";

/**
 * The workspace's 3D viewport (ADR-0008): stock, grid, work origin, geometry
 * and toolpaths in one scene, seen from an orthographic top view or a perspective
 * orbit view. The scene is in stock coordinates (millimetres, Z up, ADR-0014),
 * so changing the work origin moves only the origin marker and the grid.
 * Browser-only: load it with `next/dynamic` and `ssr: false`.
 */
export function Viewport() {
  const view = useWorkspaceStore((s) => s.view);
  const editingTabs = useWorkspaceStore((s) => s.editingTabs);
  const pickingZero = useWorkspaceStore((s) => s.pickingZero);
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

  return (
    <div
      className={cn("relative h-full", (editingTabs || pickingZero) && "cursor-crosshair")}
      {...cancelPick}
    >
      <Canvas frameloop="demand" dpr={[1, 2]} aria-label="Stock, geometry and toolpaths">
        {view === "top" ? (
          <TopCamera key={poseKey} box={fitBox} poses={poses} poseKey={poseKey} />
        ) : (
          <OrbitCamera key={poseKey} box={fitBox} poses={poses} poseKey={poseKey} />
        )}
        <Scene box={box} palette={palette} />
      </Canvas>
      <ViewToolbar view={view} onFit={() => setFits((n) => n + 1)} />
    </div>
  );
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
    <div
      role="toolbar"
      aria-label="View"
      className="absolute top-2 left-2 flex items-center gap-0.5 rounded-md border bg-background/90 p-0.5 shadow-xs"
    >
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
  );
}
