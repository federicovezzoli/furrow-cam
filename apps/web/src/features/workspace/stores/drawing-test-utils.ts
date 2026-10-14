import { anchorPoint, shapesBounds } from "@furrow/cam-core";
import type { Point, ProjectDocument, StockAnchor } from "@furrow/document";
import { expect } from "vitest";

/** Test helpers for where the drawing sits on the stock (ADR-0022). */

/** The point of the drawing's bounding box that `anchor` names. */
export function drawingAnchor({ geometry }: ProjectDocument, anchor: StockAnchor): Point {
  const bounds = shapesBounds(geometry);
  if (!bounds) throw new Error("No drawing");
  return anchorPoint(bounds, anchor);
}

/** Expects the points to match up to float noise. */
export function expectClose(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => {
    expect(value).toBeCloseTo(expected[i] as number, 6);
  });
}
