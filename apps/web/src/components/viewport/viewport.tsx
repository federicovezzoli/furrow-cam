"use client";

import { type Box3, stockBounds, stockOffset } from "@furrow/cam-core";
import type { Shape } from "@furrow/document";
import { Edges, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { BoxIcon, ScanIcon, SquareIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { memo, useEffect, useMemo, useState } from "react";
import { BufferGeometry, Float32BufferAttribute, MOUSE, TOUCH } from "three";
import { Button } from "@/components/ui/button";
import {
  boxCenter,
  fitOrbitPosition,
  fitTopZoom,
  gridLinePositions,
  shapeLinePositions,
} from "@/lib/viewport-scene";
import type { ViewMode } from "@/stores/workspace-store";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "@/stores/workspace-stores";

type Palette = {
  shape: string;
  hovered: string;
  selected: string;
  stock: string;
  stockEdges: string;
  gridMinor: string;
  gridMajor: string;
};

const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    shape: "#27272a",
    hovered: "#60a5fa",
    selected: "#2563eb",
    stock: "#d4a373",
    stockEdges: "#a16207",
    gridMinor: "#e4e4e7",
    gridMajor: "#c4c4c8",
  },
  dark: {
    shape: "#e4e4e7",
    hovered: "#1d4ed8",
    selected: "#60a5fa",
    stock: "#a47148",
    stockEdges: "#d4a373",
    gridMinor: "#2a2a2d",
    gridMajor: "#45454a",
  },
};

/** Length in millimetres of the origin marker's axes. */
const ORIGIN_MARKER_SIZE = 40;

/**
 * The workspace's 3D viewport (ADR-0008): stock, grid, origin and geometry in
 * one scene, seen from an orthographic top view or a perspective orbit view.
 * The scene is in work coordinates (millimetres, Z up). Browser-only: load it
 * with `next/dynamic` and `ssr: false`.
 */
export function Viewport() {
  const view = useWorkspaceStore((s) => s.view);
  const { resolvedTheme } = useTheme();
  const palette = PALETTES[resolvedTheme === "dark" ? "dark" : "light"];
  // Bumped to fit the camera to the stock again; remounting the camera does it.
  const [fits, setFits] = useState(0);

  return (
    <div className="relative h-full">
      <Canvas frameloop="demand" dpr={[1, 2]} aria-label="Stock and geometry">
        {view === "top" ? <TopCamera key={`top-${fits}`} /> : <OrbitCamera key={`orbit-${fits}`} />}
        <Scene palette={palette} />
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

/** The stock's bounds in work coordinates, recomputed only when the stock changes. */
function useStockBounds(): Box3 {
  const stock = useDocumentStore((s) => s.document.stock);
  return useMemo(() => stockBounds(stock), [stock]);
}

/** Bounds read once, for fitting the camera when it mounts without following later edits. */
function useInitialStockBounds(): Box3 {
  const documentStore = useDocumentStoreApi();
  const [bounds] = useState(() => stockBounds(documentStore.getState().document.stock));
  return bounds;
}

/**
 * Looking straight down, fitted to the stock when mounted; the camera is the
 * user's to move after that. The left button is left free for selecting.
 */
function TopCamera() {
  const bounds = useInitialStockBounds();
  const get = useThree((s) => s.get);
  const [zoom] = useState(() => fitTopZoom(bounds, get().size));
  const [x, y] = boxCenter(bounds);
  const top = bounds.max[2];

  return (
    <>
      <OrthographicCamera
        makeDefault
        position={[x, y, top + 1000]}
        zoom={zoom}
        near={1}
        far={100_000}
      />
      {/* Controls are rebuilt when the default camera changes, so the target is a prop, not set once. */}
      <OrbitControls
        makeDefault
        target={[x, y, top]}
        enableRotate={false}
        screenSpacePanning
        zoomToCursor
        mouseButtons={{ MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }}
        touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
      />
    </>
  );
}

const ORBIT_FOV = 40;

/** Seen from the front right, fitted to the stock when mounted. */
function OrbitCamera() {
  const bounds = useInitialStockBounds();
  const get = useThree((s) => s.get);
  const [position] = useState(() => {
    const { width, height } = get().size;
    return fitOrbitPosition(bounds, ORBIT_FOV, height > 0 ? width / height : 1);
  });

  return (
    <>
      <PerspectiveCamera
        makeDefault
        up={[0, 0, 1]}
        fov={ORBIT_FOV}
        position={position}
        near={1}
        far={100_000}
      />
      <OrbitControls makeDefault target={boxCenter(bounds)} screenSpacePanning />
    </>
  );
}

function Scene({ palette }: { palette: Palette }) {
  const bounds = useStockBounds();
  return (
    <>
      <Grid bounds={bounds} palette={palette} />
      <Stock bounds={bounds} palette={palette} />
      {/* X red, Y green, Z blue; drawn over the stock edges it runs along. */}
      <axesHelper args={[ORIGIN_MARKER_SIZE]} renderOrder={2} material-depthTest={false} />
      <Shapes palette={palette} />
    </>
  );
}

/** A `BufferGeometry` for line positions, disposed when replaced or unmounted. */
function useLineGeometry(positions: Float32Array) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

function Grid({ bounds, palette }: { bounds: Box3; palette: Palette }) {
  const { minor, major } = useMemo(() => gridLinePositions(bounds), [bounds]);
  const minorGeometry = useLineGeometry(minor);
  const majorGeometry = useLineGeometry(major);
  return (
    <>
      <lineSegments geometry={minorGeometry}>
        <lineBasicMaterial color={palette.gridMinor} />
      </lineSegments>
      <lineSegments geometry={majorGeometry}>
        <lineBasicMaterial color={palette.gridMajor} />
      </lineSegments>
    </>
  );
}

function Stock({ bounds, palette }: { bounds: Box3; palette: Palette }) {
  const { min, max } = bounds;
  return (
    <mesh position={boxCenter(bounds)}>
      <boxGeometry args={[max[0] - min[0], max[1] - min[1], max[2] - min[2]]} />
      {/* Translucent and not hiding what is behind it, so geometry on its top always shows. */}
      <meshBasicMaterial color={palette.stock} transparent opacity={0.25} depthWrite={false} />
      <Edges color={palette.stockEdges} />
    </mesh>
  );
}

/** Imported geometry on the stock top, highlighted from the workspace store's selection. */
function Shapes({ palette }: { palette: Palette }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const stock = useDocumentStore((s) => s.document.stock);
  const offset = useMemo(() => stockOffset(stock), [stock]);
  const selectedIds = useWorkspaceStore((s) => s.selectedShapeIds);
  const hoveredId = useWorkspaceStore((s) => s.hoveredShapeId);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  return geometry.map((shape) => {
    const state = selected.has(shape.id)
      ? "selected"
      : shape.id === hoveredId
        ? "hovered"
        : "shape";
    return (
      <ShapeLines
        key={shape.id}
        shape={shape}
        offset={offset}
        color={palette[state]}
        // Highlighted shapes draw last, so they show over overlapping ones.
        renderOrder={state === "shape" ? 0 : 1}
      />
    );
  });
}

const ShapeLines = memo(function ShapeLines({
  shape,
  offset,
  color,
  renderOrder,
}: {
  shape: Shape;
  offset: [number, number, number];
  color: string;
  renderOrder: number;
}) {
  // Immer keeps unchanged shapes as the same objects, so only edited shapes re-flatten.
  const positions = useMemo(() => shapeLinePositions(shape, offset), [shape, offset]);
  const geometry = useLineGeometry(positions);
  return (
    <lineSegments geometry={geometry} renderOrder={renderOrder}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  );
});
