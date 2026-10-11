"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";

/** A `BufferGeometry` for line positions, disposed when replaced or unmounted. */
export function useLineGeometry(positions: Float32Array) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

export function Lines({
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
