"use client";

import { stockBox } from "@furrow/cam-core";
import { Canvas } from "@react-three/fiber";
import { cn } from "cn";
import { BoxIcon, ScanIcon, SquareIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ViewMode } from "@/stores/workspace-store";
import { useDocumentStore, useWorkspaceStore } from "@/stores/workspace-stores";
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
  const { resolvedTheme } = useTheme();
  const palette = PALETTES[resolvedTheme === "dark" ? "dark" : "light"];
  const { width, height, thickness } = useDocumentStore((s) => s.document.stock);
  const box = useMemo(() => stockBox({ width, height, thickness }), [width, height, thickness]);
  // Pressing Fit or resizing the stock fits the camera again: new keys remount
  // the cameras, which then find no saved pose.
  const [fits, setFits] = useState(0);
  const poseKey = `${view}:${fits}:${width}x${height}x${thickness}`;
  const [poses] = useState<CameraPoses>(() => new Map());

  return (
    <div className={cn("relative h-full", editingTabs && "cursor-crosshair")}>
      <Canvas frameloop="demand" dpr={[1, 2]} aria-label="Stock, geometry and toolpaths">
        {view === "top" ? (
          <TopCamera key={poseKey} box={box} poses={poses} poseKey={poseKey} />
        ) : (
          <OrbitCamera key={poseKey} box={box} poses={poses} poseKey={poseKey} />
        )}
        <Scene box={box} palette={palette} />
      </Canvas>
      <ViewToolbar view={view} onFit={() => setFits((n) => n + 1)} />
    </div>
  );
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
