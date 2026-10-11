"use client";

import type { Point } from "@furrow/document";
import type { ThreeElements } from "@react-three/fiber";
import { Plane, type Ray, Vector3 } from "three";

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
