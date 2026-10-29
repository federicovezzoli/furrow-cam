"use client";

import { type Box3, type Heightmap, stockBox, xyOriginPosition } from "@furrow/cam-core";
import { Button } from "@furrow/ui/components/ui/button";
import { Canvas } from "@react-three/fiber";
import { RouteIcon, RouteOffIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { type HeightmapUpdates, usePlayback } from "../../hooks/use-playback";
import { heightmapCellLimit } from "../../lib/simulation-mesh";
import { boxWithPoint } from "../../lib/viewport-scene";
import {
  useDocumentStore,
  useToolpathStore,
  useWorkspaceStore,
} from "../../providers/workspace-stores";
import { type CameraPoses, OrbitCamera, TopCamera } from "./cameras";
import { PlaybackProvider, PlaybackTool } from "./playback";
import { PlaybackTimeline } from "./playback-timeline";
import { ReportCapture } from "./report-capture";
import { Stock, WorkOrigin } from "./scene";
import { PALETTES, type Palette } from "./scene-style";
import { SimulatedStock } from "./simulated-stock";
import { Toolpaths } from "./toolpaths";
import {
  SideButtons,
  simulationStatus,
  TextureLimit,
  TOOLBAR_GROUP,
  ViewButtons,
} from "./viewport";

/**
 * The simulator's viewport (#100, ADR-0042): the stock cut move by move as
 * the playback advances, the tool drawn where it is, the toolpaths trailing
 * behind it (unless hidden), and the timeline under the scene. Cameras,
 * views and, in a two-sided project, sides work as in the workspace. Browser-only: load it with `next/dynamic` and `ssr: false`.
 */
export function SimulatorViewport() {
  const view = useWorkspaceStore((s) => s.view);
  // Known once the renderer is up, inside the canvas.
  const [maxTextureSize, setMaxTextureSize] = useState<number | null>(null);
  const playback = usePlayback(maxTextureSize === null ? null : heightmapCellLimit(maxTextureSize));
  const units = useDocumentStore((s) => s.document.units);
  const operations = useDocumentStore((s) => s.document.operations);
  const entries = useToolpathStore((s) => s.entries);
  const { side } = playback;
  // The bottom side is played back over the top side's cuts, so its failures count too.
  const skipped = useMemo(
    () =>
      operations
        .filter(
          (op) =>
            op.enabled &&
            (side === "bottom" || op.stockSide === "top") &&
            entries[op.id]?.status === "error",
        )
        .map((op) => op.name),
    [operations, entries, side],
  );
  const { resolvedTheme } = useTheme();
  const palette = PALETTES[resolvedTheme === "dark" ? "dark" : "light"];
  const stock = useDocumentStore((s) => s.document.stock);
  const { width, height, thickness } = stock;
  const box = useMemo(() => stockBox({ width, height, thickness }), [width, height, thickness]);
  const fitBox = useMemo(() => boxWithPoint(box, [...xyOriginPosition(stock), 0]), [box, stock]);
  const [fits, setFits] = useState(0);
  const [showToolpaths, setShowToolpaths] = useState(true);
  const ToolpathsIcon = showToolpaths ? RouteIcon : RouteOffIcon;
  const poseKey = `${view}:${fits}:${width}x${height}x${thickness}`;
  const [poses] = useState<CameraPoses>(() => new Map());
  // A heightmap of the stock before a resize would sit at the old size and depth.
  const sim = playback.stock;
  const heightmap =
    sim !== null && sim.width === width && sim.height === height && sim.thickness === thickness
      ? playback.heightmap
      : null;
  const t = useTranslations("Viewport");
  const status = [
    ...(side === "bottom" ? [t("bottomSideHint")] : []),
    // The top side is played back as it is cut, before the stock is turned over.
    ...(side === "top" && stock.twoSided ? [t("topSideSimulationHint")] : []),
    ...simulationStatus(t, { ...playback, skipped }),
  ];
  const { store, path, parts } = playback;
  const scene = useMemo(() => path && { store, path, parts }, [store, path, parts]);
  const nothing = !operations.some((op) => op.enabled && op.stockSide === side);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section aria-label={t("simulation")} className="relative min-h-0 flex-1 bg-muted/40">
        <Canvas frameloop="demand" dpr={[1, 2]} aria-label={t("simulationScene")}>
          <ReportCapture />
          {view === "top" ? (
            <TopCamera key={poseKey} box={fitBox} poses={poses} poseKey={poseKey} />
          ) : (
            <OrbitCamera key={poseKey} box={fitBox} poses={poses} poseKey={poseKey} />
          )}
          <PlaybackProvider value={scene}>
            <SimulatorScene
              box={box}
              palette={palette}
              heightmap={heightmap}
              updates={playback.updates}
              showToolpaths={showToolpaths}
            />
          </PlaybackProvider>
          <TextureLimit onLimit={setMaxTextureSize} />
        </Canvas>
        <div className="absolute top-2 left-2 flex items-center gap-2">
          <ViewButtons view={view} onFit={() => setFits((n) => n + 1)} />
          <SideButtons />
          <div role="toolbar" aria-label={t("cut")} className={TOOLBAR_GROUP}>
            <Button
              variant={showToolpaths ? "secondary" : "ghost"}
              size="icon-compact"
              aria-label={t("showToolpaths")}
              aria-pressed={showToolpaths}
              title={showToolpaths ? t("hideToolpathsShort") : t("showToolpathsShort")}
              onClick={() => setShowToolpaths(!showToolpaths)}
            >
              <ToolpathsIcon />
            </Button>
          </div>
        </div>
        {nothing && (
          <p className="absolute inset-x-0 top-1/2 text-center text-ui text-muted-foreground">
            {t("nothing")}
          </p>
        )}
      </section>
      <PlaybackTimeline store={store} path={path} parts={parts} units={units} status={status} />
    </div>
  );
}

/**
 * The stock, uncut until the playback's heightmap is ready, with the tool
 * and, if `showToolpaths`, the toolpaths cut so far.
 */
function SimulatorScene({
  box,
  palette,
  heightmap,
  updates,
  showToolpaths,
}: {
  box: Box3;
  palette: Palette;
  heightmap: Heightmap | null;
  updates: HeightmapUpdates;
  showToolpaths: boolean;
}) {
  return (
    <>
      <WorkOrigin palette={palette} />
      {heightmap ? (
        <SimulatedStock
          heightmap={heightmap}
          thickness={-box.min[2]}
          color={palette.stock}
          updates={updates}
        />
      ) : (
        <Stock box={box} palette={palette} />
      )}
      {/* Its own toggle decides, whatever the Operations pane hides. */}
      {showToolpaths && <Toolpaths palette={palette} showHidden />}
      <PlaybackTool />
    </>
  );
}
