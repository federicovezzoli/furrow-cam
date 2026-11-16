import type { PocketParams, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import {
  below,
  distanceToSegment,
  dumbbell,
  expectNoLinkThroughStock,
  expectNoWideCut,
  island,
  lifts,
  pocketOperation,
  pocketTool,
  rectangle,
  square,
} from "../link-test-utils";
import { pocketToolpath } from "./pocket";

// The moves linear clearing makes without retracting (#574): along the lap
// from pass to pass, and through the cleared depth to the nearest pass left.
// After the laps, every pass runs within a step-over of a cut (#604). A link
// through the cleared depth that leaves the area is caught by the clearing
// outside the paths in pocket.test.ts (#386); a link along the lap runs on
// what the lap cut.

const options = { safeZ: 5, entryClearance: 1 };
const { params } = pocketOperation();
const LEVELS = Array.from(
  { length: params.depth / pocketTool.stepDown },
  (_, i) => -(i + 1) * pocketTool.stepDown,
);
const STEP_OVER = (pocketTool.diameter * params.stepOver) / 100;

/** Three 20 × 30 mm islands in a 150 × 100 mm pocket, the middle one higher. */
const islands = [
  rectangle("4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b", 0, 0, 150, 100),
  rectangle("4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a30", 20, 20, 20, 30),
  rectangle("4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a31", 65, 50, 20, 30),
  rectangle("4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a32", 110, 25, 20, 30),
];

/**
 * Whether `point` is on the laps of `shapes`, a tool radius off their
 * outlines: cut first at each level, the first of them full width.
 */
function onLaps(shapes: Shape[]) {
  const radius = pocketTool.diameter / 2;
  return (point: [number, number]) =>
    shapes.some(({ paths }) =>
      paths.some(({ start, segments, closed }) => {
        let from = start;
        // A closed path's last line back to its start isn't one of its segments.
        const end = segments.at(-1)?.to ?? start;
        const back =
          closed && (end[0] !== start[0] || end[1] !== start[1])
            ? [{ kind: "line" as const, to: start }]
            : [];
        return [...segments, ...back].some((segment) => {
          const off =
            segment.kind === "arc"
              ? Math.abs(
                  Math.hypot(point[0] - segment.center[0], point[1] - segment.center[1]) -
                    Math.hypot(from[0] - segment.center[0], from[1] - segment.center[1]),
                )
              : distanceToSegment(point, [from, segment.to]);
          from = segment.to;
          // Curves and corners are drawn to the chord tolerance.
          return Math.abs(off - radius) < 0.1;
        });
      }),
    );
}

function linear(angle: 0 | 90 | 45 | -45, shapes: Shape[], overrides: Partial<PocketParams> = {}) {
  const operation = pocketOperation({ strategy: { type: "linear", angle }, ...overrides }, shapes);
  return pocketToolpath(operation, shapes, options);
}

describe("linear clearing links", () => {
  for (const angle of [0, 45, -45, 90] as const) {
    for (const ramp of [false, true]) {
      it(`stays down around an island without cutting through stock, at ${angle}°${ramp ? ", ramping" : ""}`, () => {
        const toolpath = linear(angle, [square, island], { ramp });
        // Below the first level, every pass linked to the next at depth: out at the end, and at
        // most once to come back down onto a lap.
        expect(lifts(below(toolpath, -2))).toBeLessThanOrEqual(2);
        expectNoWideCut(toolpath, LEVELS, STEP_OVER, onLaps([square, island]));
        expectNoLinkThroughStock(toolpath, pocketTool, 100, 100);
      });
    }
  }

  // Lifts measured on this branch: clearing each region from the side already cut takes up to
  // two more a level than the nearest pass did (#604), which slotted full width instead.
  const islandLifts = { 0: [5, 3], 45: [5, 3], [-45]: [5, 5], 90: [6, 2] };
  for (const angle of [0, 45, -45, 90] as const) {
    for (const ramp of [false, true]) {
      it(`clears between three islands without cutting wide, at ${angle}°${ramp ? ", ramping" : ""}`, () => {
        const toolpath = linear(angle, islands, { ramp });
        expect(lifts(below(toolpath, -2))).toBeLessThanOrEqual(
          islandLifts[angle][ramp ? 1 : 0] ?? 0,
        );
        expectNoWideCut(toolpath, LEVELS, STEP_OVER, onLaps(islands));
        expectNoLinkThroughStock(toolpath, pocketTool, 150, 100);
      });
    }
  }

  it("crosses a neck the passes leave without cutting through stock", () => {
    for (const angle of [0, 90] as const) {
      const toolpath = linear(angle, [dumbbell], { allowance: 1 });
      // No more than before #604: out at the end, and once more.
      expect(lifts(below(toolpath, -2))).toBeLessThanOrEqual(2);
      expectNoLinkThroughStock(toolpath, pocketTool, 100, 40);
    }
  });
});
