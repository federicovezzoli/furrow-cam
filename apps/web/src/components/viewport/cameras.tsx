"use client";

import type { Box3, Vec3 } from "@furrow/cam-core";
import {
  OrbitControls,
  type OrbitControlsChangeEvent,
  OrthographicCamera,
  PerspectiveCamera,
} from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useState } from "react";
import { MOUSE, TOUCH } from "three";
import { boxCenter, fitOrbitPosition, fitTopZoom } from "@/lib/viewport-scene";

/** Where a camera looks from and at, and its zoom. */
type CameraPose = { position: Vec3; target: Vec3; zoom: number };

/** Each view's last camera pose, keyed by view and fit. */
export type CameraPoses = Map<string, CameraPose>;

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
export function TopCamera(props: CameraProps) {
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
export function OrbitCamera(props: CameraProps) {
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
