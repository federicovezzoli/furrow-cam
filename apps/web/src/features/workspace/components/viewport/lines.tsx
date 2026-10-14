"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, type LineDashedMaterial, Vector3 } from "three";
import { pixelsPerMillimetre } from "@/features/workspace/lib/viewport-scene";

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
};

export function Lines({ positions, color, colors, renderOrder, opacity = 1 }: LinesProps) {
  const shaded = colors !== undefined && colors.length > 0;
  const geometry = useLineGeometry(positions, undefined, shaded ? colors : undefined);
  if (positions.length === 0) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={renderOrder}>
      {/* Keyed: three.js compiles a material with or without vertex colours. */}
      <lineBasicMaterial
        key={String(shaded)}
        color={color}
        vertexColors={shaded}
        transparent
        opacity={opacity}
      />
    </lineSegments>
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
}: LinesProps & { distances: Float32Array }) {
  const geometry = useLineGeometry(positions, distances);
  const material = useRef<LineDashedMaterial>(null);
  // The material scales line distances (mm) into its dash units: pixels at the
  // camera's current zoom, or at its target's distance in the perspective view.
  useFrame(({ camera, controls, size }) => {
    if (!material.current) return;
    const target = (controls as { target?: Vector3 } | null)?.target ?? origin;
    const distance = camera.position.distanceTo(target);
    material.current.scale = pixelsPerMillimetre(camera, size.height, distance);
  });
  if (positions.length === 0) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={renderOrder}>
      <lineDashedMaterial ref={material} color={color} transparent opacity={opacity} {...DASH} />
    </lineSegments>
  );
}
