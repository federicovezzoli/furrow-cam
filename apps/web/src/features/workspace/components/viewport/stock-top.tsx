"use client";

import type { Point } from "@furrow/document";
import { type ThreeElements, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { type OrthographicCamera, Plane, type Ray, Raycaster, Vector3 } from "three";

const STOCK_TOP = new Plane(new Vector3(0, 0, 1), 0);

/** Where `ray` meets the stock top (`z = 0`, ADR-0014). */
export function onStockTop(ray: Ray): Point | null {
  const hit = ray.intersectPlane(STOCK_TOP, new Vector3());
  return hit ? [hit.x, hit.y] : null;
}

type CatcherHandlers = Pick<ThreeElements["mesh"], "onClick" | "onPointerMove" | "onPointerOut">;

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
 * millimetres a pixel covers there, as it moves over a `StockTopCatcher`,
 * and with `null` once it leaves. Panning or zooming moves the stock under a
 * still cursor, so it is called again on each frame while the pointer is
 * over. Top view only: its orthographic zoom is in pixels per millimetre.
 * Returns the catcher's pointer handlers.
 */
export function useStockTopHover(
  onHover: (point: Point | null, millimetresPerPixel: number) => void,
) {
  const over = useRef(false);
  const raycaster = useMemo(() => new Raycaster(), []);

  useFrame(({ camera, pointer }) => {
    if (!over.current) return;
    raycaster.setFromCamera(pointer, camera);
    onHover(onStockTop(raycaster.ray), 1 / (camera as OrthographicCamera).zoom);
  });

  return {
    onPointerMove(event: ThreeEvent<PointerEvent>) {
      over.current = true;
      onHover(onStockTop(event.ray), 1 / event.camera.zoom);
    },
    onPointerOut(event: ThreeEvent<PointerEvent>) {
      over.current = false;
      onHover(null, 1 / event.camera.zoom);
    },
  };
}
