"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, type LineDashedMaterial, Vector3 } from "three";
import { pixelsPerMillimetre, segmentLineDistances } from "@/lib/viewport-scene";

/**
 * A `BufferGeometry` for line positions, disposed when replaced or unmounted.
 * The arrays are used as they are, not copied. `dashed` adds the distances a
 * dashed material needs.
 */
export function useLineGeometry(positions: Float32Array, dashed = false) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(positions, 3));
    if (dashed) {
      g.setAttribute("lineDistance", new BufferAttribute(segmentLineDistances(positions), 1));
    }
    return g;
  }, [positions, dashed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/**
 * Dash and gap lengths in pixels of dashed lines. Lengths in millimetres
 * would blur into a solid line when zoomed out to fit the stock.
 */
const DASH = { dashSize: 6, gapSize: 4 };

const target = new Vector3();

export function Lines({
  positions,
  color,
  renderOrder,
  opacity = 1,
  dashed = false,
}: {
  positions: Float32Array;
  color: string;
  renderOrder: number;
  opacity?: number;
  dashed?: boolean;
}) {
  const geometry = useLineGeometry(positions, dashed);
  const dashedMaterial = useRef<LineDashedMaterial>(null);
  // The material scales line distances (mm) into its dash units: pixels at the
  // camera's current zoom, or at its target's distance in the perspective view.
  useFrame(({ camera, controls, size }) => {
    const material = dashedMaterial.current;
    if (!material) return;
    const orbitTarget = (controls as { target?: Vector3 } | null)?.target;
    const distance = camera.position.distanceTo(orbitTarget ?? target.set(0, 0, 0));
    material.scale = pixelsPerMillimetre(camera, size.height, distance);
  });
  if (positions.length === 0) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={renderOrder}>
      {dashed ? (
        <lineDashedMaterial
          ref={dashedMaterial}
          color={color}
          transparent
          opacity={opacity}
          {...DASH}
        />
      ) : (
        <lineBasicMaterial color={color} transparent opacity={opacity} />
      )}
    </lineSegments>
  );
}
