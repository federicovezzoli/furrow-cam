"use client";

import { Canvas } from "@react-three/fiber";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
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
 * the relief alone does, so the view the user turned to stays.
 */
export default function TerrainPreview({
  stl,
  size,
  fitKey,
}: {
  stl: ArrayBuffer;
  size: [number, number, number];
  fitKey: string;
}) {
  const t = useTranslations("Terrain");
  const { resolvedTheme } = useTheme();
  const palette = PALETTES[resolvedTheme === "dark" ? "dark" : "light"];
  // Normals averaged across gentle slopes, so they read smooth instead of as facets, but not
  // across the 90° rim between the relief and its walls, which stays sharp.
  const geometry = useMemo(() => toCreasedNormals(new STLLoader().parse(stl), Math.PI / 4), [stl]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const [poses] = useState<CameraPoses>(() => new Map());
  const box = { min: [0, 0, 0] as [number, number, number], max: size };
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} aria-label={t("preview")}>
      <OrbitCamera key={fitKey} box={box} poses={poses} poseKey={fitKey} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[-1, -1, 2]} intensity={1.6} />
      <mesh geometry={geometry}>
        <meshStandardMaterial color={palette.model} />
      </mesh>
    </Canvas>
  );
}
