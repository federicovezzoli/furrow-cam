"use client";

import type { Point } from "@furrow/document";
import { type ThreeElements, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  type Camera,
  type OrthographicCamera,
  type PerspectiveCamera,
  Plane,
  type Ray,
  Raycaster,
  Vector3,
} from "three";

const STOCK_TOP = new Plane(new Vector3(0, 0, 1), 0);

/** Where `ray` meets the stock top (`z = 0`, ADR-0014). */
export function onStockTop(ray: Ray): Point | null {
  const hit = ray.intersectPlane(STOCK_TOP, new Vector3());
  return hit ? [hit.x, hit.y] : null;
}

/**
 * How many millimetres a pixel covers at `point` on the stock top, for a
 * viewport `height` pixels tall: the top view's orthographic zoom is in
 * pixels per millimetre, while the orbit view's perspective shrinks with the
 * distance from the camera (#544).
 */
export function millimetresPerPixel(camera: Camera, point: Point, height: number): number {
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    return 1 / (camera as OrthographicCamera).zoom;
  }
  const { fov, zoom } = camera as PerspectiveCamera;
  const distance = camera.position.distanceTo(new Vector3(point[0], point[1], 0));
  return (2 * distance * Math.tan((fov * Math.PI) / 360)) / (zoom * Math.max(height, 1));
}

type CatcherHandlers = Pick<
  ThreeElements["mesh"],
  "onClick" | "onDoubleClick" | "onPointerMove" | "onPointerOut"
>;

/**
 * An invisible plane at height `z` that catches the pointer anywhere in the
 * top view, for tools that measure where it is on the stock top with
 * `onStockTop`. Objects above it (tab markers) get events first and can stop them.
 */
export function StockTopCatcher({ z, ...handlers }: { z: number } & CatcherHandlers) {
  return (
    <mesh position={[0, 0, z]} {...handlers}>
      <planeGeometry args={[100_000, 100_000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/**
 * Calls `onHover` with where the pointer is on the stock top, and how many
 * millimetres a pixel covers there (`millimetresPerPixel`), as it moves over
 * a `StockTopCatcher`, and with `null` once it leaves. Panning, zooming or
 * orbiting moves the stock under a still cursor, so it is called again on
 * each frame while the pointer is over. Returns the catcher's pointer handlers.
 */
export function useStockTopHover(
  onHover: (point: Point | null, millimetresPerPixel: number) => void,
) {
  const over = useRef(false);
  const raycaster = useMemo(() => new Raycaster(), []);

  const hover = (point: Point | null, camera: Camera, height: number) =>
    onHover(point, point ? millimetresPerPixel(camera, point, height) : 0);

  useFrame(({ camera, pointer, size }) => {
    if (!over.current) return;
    raycaster.setFromCamera(pointer, camera);
    hover(onStockTop(raycaster.ray), camera, size.height);
  });

  return {
    onPointerMove(event: ThreeEvent<PointerEvent>) {
      over.current = true;
      hover(onStockTop(event.ray), event.camera, canvasHeight(event));
    },
    onPointerOut(event: ThreeEvent<PointerEvent>) {
      over.current = false;
      hover(null, event.camera, canvasHeight(event));
    },
  };
}

/** The height in pixels of the canvas an event happened on. */
export function canvasHeight(event: ThreeEvent<MouseEvent>): number {
  return (event.nativeEvent.target as HTMLElement | null)?.clientHeight ?? 0;
}
