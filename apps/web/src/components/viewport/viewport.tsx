"use client";

import { type Box3, stockBounds, stockBox, stockOffset, type Vec3 } from "@furrow/cam-core";
import type { Shape } from "@furrow/document";
import {
  Edges,
  OrbitControls,
  type OrbitControlsChangeEvent,
  OrthographicCamera,
  PerspectiveCamera,
} from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { BoxIcon, ScanIcon, SquareIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, Float32BufferAttribute, MOUSE, TOUCH } from "three";
import { Button } from "@/components/ui/button";
import {
  boxCenter,
  fitOrbitPosition,
  fitTopZoom,
  gridLinePositions,
  shapesLinePositions,
} from "@/lib/viewport-scene";
import type { ViewMode } from "@/stores/workspace-store";
import { useDocumentStore, useWorkspaceStore } from "@/stores/workspace-stores";

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
    hovered: "#93c5fd",
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
 * Draw order of the transparent pass. Lines join it (as `transparent`
 * materials) so they draw after the translucent stock instead of being tinted
 * by it; three.js always draws opaque objects first.
 */
const RENDER_ORDER = { stock: 0, shapes: 1, selected: 2, hovered: 3, origin: 4 } as const;

/** Where a camera looks from and at, and its zoom. */
type CameraPose = { position: Vec3; target: Vec3; zoom: number };

/** Each view's last camera pose, keyed by view and fit. */
type CameraPoses = Map<string, CameraPose>;

/**
 * The workspace's 3D viewport (ADR-0008): stock, grid, work origin and
 * geometry in one scene, seen from an orthographic top view or a perspective
 * orbit view. The scene is in stock coordinates (millimetres, Z up, ADR-0014),
 * so changing the work origin moves only the origin marker and the grid.
 * Browser-only: load it with `next/dynamic` and `ssr: false`.
 */
export function Viewport() {
  const view = useWorkspaceStore((s) => s.view);
  const { resolvedTheme } = useTheme();
  const palette = PALETTES[resolvedTheme === "dark" ? "dark" : "light"];
  const { width, height, thickness } = useDocumentStore((s) => s.document.stock);
  const box = useMemo(
    () => stockBox({ width, height, thickness, xyOrigin: "bottom_left", zOrigin: "stock_top" }),
    [width, height, thickness],
  );
  // Pressing Fit or resizing the stock fits the camera again: new keys remount
  // the cameras, which then find no saved pose.
  const [fits, setFits] = useState(0);
  const poseKey = `${view}:${fits}:${width}x${height}x${thickness}`;
  const [poses] = useState<CameraPoses>(() => new Map());

  return (
    <div className="relative h-full">
      <Canvas frameloop="demand" dpr={[1, 2]} aria-label="Stock and geometry">
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

type CameraProps = { box: Box3; poses: CameraPoses; poseKey: string };

/**
 * The pose a camera mounts with: where it was last left in this view, or
 * `fit()` the first time. Returns the controls' `onChange`, which remembers it.
 */
function useCameraPose(
  { poses, poseKey }: CameraProps,
  fit: () => CameraPose,
): [CameraPose, (event?: OrbitControlsChangeEvent) => void] {
  const [pose] = useState(() => poses.get(poseKey) ?? fit());
  function remember(event?: OrbitControlsChangeEvent) {
    if (!event) return;
    const { object: camera, target } = event.target;
    poses.set(poseKey, {
      position: camera.position.toArray(),
      target: target.toArray(),
      zoom: camera.zoom,
    });
  }
  return [pose, remember];
}

/** Looking straight down. The left button is left free for selecting. */
function TopCamera(props: CameraProps) {
  const get = useThree((s) => s.get);
  const [pose, remember] = useCameraPose(props, () => {
    const [x, y] = boxCenter(props.box);
    const top = props.box.max[2];
    return {
      position: [x, y, top + 1000],
      target: [x, y, top],
      zoom: fitTopZoom(props.box, get().size),
    };
  });

  return (
    <>
      <OrthographicCamera
        makeDefault
        position={pose.position}
        zoom={pose.zoom}
        near={1}
        far={100_000}
      />
      {/* Controls are rebuilt when the default camera changes, so the target is a prop, not set once. */}
      <OrbitControls
        makeDefault
        target={pose.target}
        onChange={remember}
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

/** Seen from the front right the first time. */
function OrbitCamera(props: CameraProps) {
  const get = useThree((s) => s.get);
  const [pose, remember] = useCameraPose(props, () => {
    const { width, height } = get().size;
    return {
      position: fitOrbitPosition(props.box, ORBIT_FOV, height > 0 ? width / height : 1),
      target: boxCenter(props.box),
      zoom: 1,
    };
  });

  return (
    <>
      <PerspectiveCamera
        makeDefault
        up={[0, 0, 1]}
        fov={ORBIT_FOV}
        position={pose.position}
        zoom={pose.zoom}
        near={1}
        far={100_000}
      />
      <OrbitControls makeDefault target={pose.target} onChange={remember} screenSpacePanning />
    </>
  );
}

function Scene({ box, palette }: { box: Box3; palette: Palette }) {
  return (
    <>
      <WorkOrigin palette={palette} />
      <Stock box={box} palette={palette} />
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

/** The origin marker and the grid aligned to it, placed where the stock's origin settings say. */
function WorkOrigin({ palette }: { palette: Palette }) {
  const stock = useDocumentStore((s) => s.document.stock);
  const offset = useMemo(() => stockOffset(stock), [stock]);
  const { minor, major } = useMemo(() => gridLinePositions(stockBounds(stock)), [stock]);
  const minorGeometry = useLineGeometry(minor);
  const majorGeometry = useLineGeometry(major);
  return (
    // Work coordinates are stock coordinates moved by `offset`, so this undoes it.
    <group position={[-offset[0], -offset[1], -offset[2]]}>
      <lineSegments geometry={minorGeometry}>
        <lineBasicMaterial color={palette.gridMinor} />
      </lineSegments>
      <lineSegments geometry={majorGeometry}>
        <lineBasicMaterial color={palette.gridMajor} />
      </lineSegments>
      {/* X red, Y green, Z blue; drawn over the stock edges it may run along. */}
      <axesHelper
        args={[ORIGIN_MARKER_SIZE]}
        renderOrder={RENDER_ORDER.origin}
        material-transparent
        material-depthTest={false}
      />
    </group>
  );
}

function Stock({ box, palette }: { box: Box3; palette: Palette }) {
  const { min, max } = box;
  return (
    <mesh position={boxCenter(box)} renderOrder={RENDER_ORDER.stock}>
      <boxGeometry args={[max[0] - min[0], max[1] - min[1], max[2] - min[2]]} />
      {/* Not writing depth, so lines drawn after it on its top face always show. */}
      <meshBasicMaterial color={palette.stock} transparent opacity={0.25} depthWrite={false} />
      <Edges color={palette.stockEdges} />
    </mesh>
  );
}

/**
 * Imported geometry on the stock top: all shapes in one draw call, then the
 * selected and hovered shapes (from the workspace store) drawn over them.
 * Each layer subscribes on its own, so hovering redraws only its overlay.
 */
function Shapes({ palette }: { palette: Palette }) {
  return (
    <>
      <AllShapes color={palette.shape} />
      <SelectedShapes color={palette.selected} />
      <HoveredShape color={palette.hovered} />
    </>
  );
}

function AllShapes({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const positions = useMemo(() => shapesLinePositions(geometry), [geometry]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.shapes} />;
}

function SelectedShapes({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selectedIds = useWorkspaceStore((s) => s.selectedShapeIds);
  const positions = useMemo(() => {
    const selected = new Set(selectedIds);
    return shapesLinePositions(geometry.filter((shape) => selected.has(shape.id)));
  }, [geometry, selectedIds]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.selected} />;
}

/** The hovered shape, unless it is selected: selection wins. */
function HoveredShape({ color }: { color: string }) {
  const geometry = useDocumentStore((s) => s.document.geometry);
  const hoveredId = useWorkspaceStore((s) =>
    s.hoveredShapeId !== null && !s.selectedShapeIds.includes(s.hoveredShapeId)
      ? s.hoveredShapeId
      : null,
  );
  const positions = useMemo(() => {
    const hovered = geometry.filter((shape: Shape) => shape.id === hoveredId);
    return shapesLinePositions(hovered);
  }, [geometry, hoveredId]);
  return <Lines positions={positions} color={color} renderOrder={RENDER_ORDER.hovered} />;
}

function Lines({
  positions,
  color,
  renderOrder,
}: {
  positions: Float32Array;
  color: string;
  renderOrder: number;
}) {
  const geometry = useLineGeometry(positions);
  if (positions.length === 0) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={renderOrder}>
      <lineBasicMaterial color={color} transparent />
    </lineSegments>
  );
}
