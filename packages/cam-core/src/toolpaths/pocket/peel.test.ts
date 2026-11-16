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
  square,
} from "../link-test-utils";
import { pocketToolpath } from "./pocket";

// The moves peel clearing makes without retracting (#574): stepping over to
// the next front at depth, and through what is cut to the nearest one left.

const options = { safeZ: 5, entryClearance: 1 };
const LEVELS = [-2, -4, -6];
/** 40% of the 6 mm tool. */
const STEP_OVER = 2.4;

/** Whether the straight way from `a` to `b` comes within the tool's radius of the island. */
function overIsland([ax = 0, ay = 0]: readonly number[], [bx = 0, by = 0]: readonly number[]) {
  return (
    distanceToSegment(
      [50, 50],
      [
        [ax, ay],
        [bx, by],
      ],
    ) <
    10 + pocketTool.diameter / 2
  );
}

/** Distance from the lap 3 mm inside the square's walls. */
const offWallLap = ([x, y]: [number, number]) =>
  Math.abs(Math.max(Math.abs(x - 50), Math.abs(y - 50)) - 47);

/** Where each start's first cut of a level is, which cuts full width. */
const starting = {
  centre: ([x, y]: [number, number]) => Math.hypot(x - 50, y - 50) <= STEP_OVER + 1e-2,
  inside: ([x, y]: [number, number]) => Math.abs(Math.hypot(x - 50, y - 50) - 13) < 1e-2,
  outside: (point: [number, number]) => offWallLap(point) < 1e-2,
};

function peel(
  start: "centre" | "inside" | "outside",
  shapes: Shape[],
  overrides: Partial<PocketParams> = {},
) {
  const operation = pocketOperation({ strategy: { type: "peel", start }, ...overrides }, shapes);
  return pocketToolpath(operation, shapes, options);
}

describe("peel clearing links", () => {
  for (const [start, shapes] of [
    ["centre", [square]],
    ["inside", [square, island]],
    ["outside", [square, island]],
  ] as const) {
    for (const ramp of [false, true]) {
      it(`stays down from front to front without cutting through stock, from the ${start}${ramp ? ", ramping" : ""}`, () => {
        const toolpath = peel(start, [...shapes], { ramp });
        // Below the first level, the tool only leaves the cut to go over the island, and at the end.
        const { moves } = below(toolpath, -2);
        const over = moves.flatMap((move, i) => {
          const from = moves[i - 1]?.to;
          if (!from || move.kind !== "rapid" || move.to[2] <= from[2]) return [];
          const back = moves.slice(i).find(({ kind }) => kind !== "rapid")?.to;
          return back ? [overIsland(from, back)] : [];
        });
        if (start === "outside") {
          // From the walls in, some fronts are only reached over the island.
          expect(over.length).toBeGreaterThan(0);
          expect(over.every(Boolean)).toBe(true);
        } else {
          // Grown out from the centre or the island: down to the end.
          expect(over).toEqual([]);
          expect(lifts({ ...toolpath, moves })).toBe(1);
        }
        expectNoWideCut(toolpath, LEVELS, STEP_OVER, starting[start]);
        expectNoLinkThroughStock(toolpath, pocketTool, 100, 100);
      });
    }
  }

  it("crosses a neck the fronts leave without cutting through stock", () => {
    const toolpath = peel("outside", [dumbbell], { allowance: 1 });
    const path = dumbbell.paths[0];
    if (!path) throw new Error("no path");
    const corners = [path.start, ...path.segments.map(({ to }) => to)];
    // The lap 3 mm in from the walls plus the 1 mm allowance.
    const onLap = (point: [number, number]) =>
      Math.abs(
        Math.min(
          ...corners.map((corner, i) =>
            distanceToSegment(point, [corner, corners[(i + 1) % corners.length] ?? corner]),
          ),
        ) - 4,
      ) < 1e-2;
    expectNoWideCut(toolpath, LEVELS, STEP_OVER, onLap);
    expectNoLinkThroughStock(toolpath, pocketTool, 100, 40);
  });
});
