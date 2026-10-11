import type { Point } from "@furrow/document";
import { Plane, type Ray, Vector3 } from "three";

const STOCK_TOP = new Plane(new Vector3(0, 0, 1), 0);

/** Where `ray` meets the stock top (`z = 0`, ADR-0014). */
export function onStockTop(ray: Ray): Point | null {
  const hit = ray.intersectPlane(STOCK_TOP, new Vector3());
  return hit ? [hit.x, hit.y] : null;
}
