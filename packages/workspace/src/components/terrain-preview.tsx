"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useTranslations } from "use-intl";
import { type CameraPoses, OrbitCamera } from "./viewport/cameras";
import { PALETTES } from "./viewport/scene-style";

/**
 * The terrain's coarse mesh in 3D (PRD-0014 T4), to turn and look at before
 * it is made at full detail. `stl` is a binary STL in mm, its lowest corner
 * at the origin, `size` its width, depth and height. The camera fits the
 * mesh again when `fitKey` changes (a new area or longest side), not when
 * the relief alone does, so the view the user turned to stays. While
 * `current` (the settings haven't changed since it was made) and drawn, it
 * is marked `terrain-preview-ready`, which the demo videos wait for (ADR-0075).
 */
export default function TerrainPreview({
  stl,
  size,
  fitKey,
  current,
}: {
  stl: ArrayBuffer;
  size: [number, number, number];
  fitKey: string;
  current: boolean;
}) {
  const t = useTranslations("Terrain");
  const { resolvedTheme } = useTheme();
  const palette = PALETTES[resolvedTheme === "dark" ? "dark" : "light"];
  // Normals averaged across gentle slopes, so they read smooth instead of as facets, but not
  // across the 90° rim between the relief and its walls, which stays sharp.
  const geometry = useMemo(() => toCreasedNormals(new STLLoader().parse(stl), Math.PI / 4), [stl]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const [poses] = useState<CameraPoses>(() => new Map());
  const [drawn, setDrawn] = useState<BufferGeometry | null>(null);
  const box = { min: [0, 0, 0] as [number, number, number], max: size };
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      aria-label={t("preview")}
      data-demo={current && drawn === geometry ? "terrain-preview-ready" : undefined}
    >
      <Drawn geometry={geometry} onDrawn={setDrawn} />
      <OrbitCamera key={fitKey} box={box} poses={poses} poseKey={fitKey} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[-1, -1, 2]} intensity={1.6} />
      <mesh geometry={geometry}>
        <meshStandardMaterial color={palette.model} />
      </mesh>
    </Canvas>
  );
}

/** Hears that a frame with `geometry` has been rendered, once per geometry. */
function Drawn({
  geometry,
  onDrawn,
}: {
  geometry: BufferGeometry;
  onDrawn: (geometry: BufferGeometry) => void;
}) {
  const told = useRef<BufferGeometry | null>(null);
  // Called before the frame renders: the state it sets commits after that frame is drawn.
  useFrame(() => {
    if (told.current === geometry) return;
    told.current = geometry;
    onDrawn(geometry);
  });
  return null;
}
