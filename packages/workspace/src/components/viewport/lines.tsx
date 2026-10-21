"use client";

import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, type LineDashedMaterial, Vector3 } from "three";
import { pixelsPerMillimetre } from "../../lib/viewport-scene";

/**
 * A `BufferGeometry` for line positions, disposed when replaced or unmounted.
 * The arrays are used as they are, not copied. `distances` are the
 * `lineDistance` values a dashed material needs, `colors` RGB values per
 * vertex that multiply the material's colour.
 *
 * Replacing or unmounting it also requests a frame: the canvas only renders
 * on demand, and React Three Fiber 9 doesn't when an object is removed
 * (`removeChild` unlinks the parent `invalidateInstance` needs), so hidden or
 * emptied lines would stay on screen until the next interaction.
 */
export function useLineGeometry(
  positions: Float32Array,
  distances?: Float32Array,
  colors?: Float32Array,
) {
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(positions, 3));
    if (distances) g.setAttribute("lineDistance", new BufferAttribute(distances, 1));
    if (colors) g.setAttribute("color", new BufferAttribute(colors, 3));
    return g;
  }, [positions, distances, colors]);
  useEffect(
    () => () => {
      geometry.dispose();
      invalidate();
    },
    [geometry, invalidate],
  );
  return geometry;
}

type LinesProps = {
  positions: Float32Array;
  color: string;
  /** Per-vertex multipliers of `color`, as in `useLineGeometry`; empty for none. */
  colors?: Float32Array;
  renderOrder: number;
  opacity?: number;
  /** Draws only segments `[first, end)`, e.g. those a playback has cut (#100). */
  segments?: [number, number];
  /** Drawn over everything, even where the stock hides them. */
  overlay?: boolean;
};

/** Limits `geometry` to the line segments `[first, end)`, or all of them without `segments`. */
function useSegmentRange(geometry: BufferGeometry, segments: [number, number] | undefined) {
  const invalidate = useThree((s) => s.invalidate);
  const [first, end] = segments ?? [0, Infinity];
  useLayoutEffect(() => {
    geometry.setDrawRange(first * 2, end === Infinity ? Infinity : (end - first) * 2);
    invalidate();
  }, [geometry, first, end, invalidate]);
  return end > first;
}

export function Lines({
  positions,
  color,
  colors,
  renderOrder,
  opacity = 1,
  segments,
  overlay = false,
}: LinesProps) {
  const shaded = colors !== undefined && colors.length > 0;
  const geometry = useLineGeometry(positions, undefined, shaded ? colors : undefined);
  const any = useSegmentRange(geometry, segments);
  if (positions.length === 0 || !any) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={renderOrder}>
      {/* Keyed: three.js compiles a material with or without vertex colours. */}
      <lineBasicMaterial
        key={String(shaded)}
        color={color}
        vertexColors={shaded}
        transparent
        opacity={opacity}
        depthTest={!overlay}
      />
    </lineSegments>
  );
}

/**
 * Lines `width` pixels wide, which WebGL's own lines can't be, drawn over
 * everything. For a few lines at a time, such as the selection: each is a
 * quad of its own.
 */
export function WideLines({
  positions,
  color,
  width,
  renderOrder,
  opacity = 1,
}: {
  positions: Float32Array;
  color: string;
  width: number;
  renderOrder: number;
  opacity?: number;
}) {
  const points = useMemo(() => Array.from(positions), [positions]);
  const line = useRef<ComponentRef<typeof Line>>(null);
  // Joins the transparent pass, drawn after the translucent stock, as `Lines` do.
  useLayoutEffect(() => {
    if (!line.current) return;
    line.current.material.transparent = true;
    line.current.material.opacity = opacity;
    line.current.material.depthTest = false;
  });
  if (points.length === 0) return null;
  return (
    <Line
      ref={line}
      points={points}
      segments
      color={color}
      lineWidth={width}
      renderOrder={renderOrder}
    />
  );
}

/**
 * Dash and gap lengths in pixels of dashed lines. Lengths in millimetres
 * would blur into a solid line when zoomed out to fit the stock.
 */
const DASH = { dashSize: 6, gapSize: 4 };

const origin = new Vector3();

/**
 * Lines dashed a constant size on screen, `distances` as in
 * `useLineGeometry`. Separate from `Lines`, so only dashed lines do work on
 * every frame.
 */
export function DashedLines({
  positions,
  distances,
  color,
  renderOrder,
  opacity = 1,
  segments,
  overlay = false,
}: LinesProps & { distances: Float32Array }) {
  const geometry = useLineGeometry(positions, distances);
  const any = useSegmentRange(geometry, segments);
  const material = useRef<LineDashedMaterial>(null);
  // The material scales line distances (mm) into its dash units: pixels at the
  // camera's current zoom, or at its target's distance in the perspective view.
  useFrame(({ camera, controls, size }) => {
    if (!material.current) return;
    const target = (controls as { target?: Vector3 } | null)?.target ?? origin;
    const distance = camera.position.distanceTo(target);
    material.current.scale = pixelsPerMillimetre(camera, size.height, distance);
  });
  if (positions.length === 0 || !any) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={renderOrder}>
      <lineDashedMaterial
        ref={material}
        color={color}
        transparent
        opacity={opacity}
        depthTest={!overlay}
        {...DASH}
      />
    </lineSegments>
  );
}
