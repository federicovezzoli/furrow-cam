import type { FlipAxis, Operation, ProjectDocument, Shape } from "@furrow/document";
import { DRAWING_ID, drill, endMill, fullDocument } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { signedArea } from "../geometry/clipper";
import { flipPoint2 } from "../scene/sides";
import { generateToolpath, toolpathInputs } from "./generate";
import type { Toolpath } from "./toolpath";

/** An L with a rounded corner, nowhere near symmetric, on a 200 × 120 mm stock. */
const ELL: Shape = {
  id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
  name: "L",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [
    {
      start: [20, 10],
      segments: [
        { kind: "line", to: [70, 10] },
        { kind: "arc", to: [70, 50], center: [70, 30], clockwise: false },
        { kind: "line", to: [40, 50] },
        { kind: "line", to: [40, 80] },
        { kind: "line", to: [20, 80] },
      ],
      closed: true,
    },
  ],
};

const STOCK = { width: 200, height: 120, thickness: 18 };
const DEPTH = 5;

const base = { name: "Cut", enabled: true, targets: [{ shapeId: ELL.id, paths: null }] };
const profile = (side: "inside" | "outside", direction: "climb" | "conventional", tabs = false) =>
  ({
    ...base,
    id: crypto.randomUUID(),
    type: "profile",
    tool: endMill,
    stockSide: "top",
    params: {
      side,
      direction,
      depth: DEPTH,
      allowance: 0,
      finishPass: false,
      leadIn: null,
      ramp: false,
      tabs: tabs ? { width: 8, height: 2, positions: [[45, 10]] } : null,
    },
  }) satisfies Operation;
/** A 6 mm hole centred at (150, 30), for the 6 mm drill. */
const HOLE: Shape = {
  ...ELL,
  id: "5a9b2d3f-7c4e-4f6a-8b8c-9d0e1f2a3b4c",
  paths: [
    {
      start: [153, 30],
      segments: [{ kind: "arc", to: [153, 30], center: [150, 30], clockwise: false }],
      closed: true,
    },
  ],
};

const pocket = {
  ...base,
  id: crypto.randomUUID(),
  type: "pocket",
  tool: endMill,
  stockSide: "top",
  params: {
    strategy: { type: "offset" },
    direction: "climb",
    stepOver: 40,
    depth: DEPTH,
    allowance: 0,
    finishPass: false,
    ramp: false,
  },
} satisfies Operation;

const pocketing = (direction: "climb" | "conventional") =>
  ({
    ...pocket,
    id: crypto.randomUUID(),
    params: { ...pocket.params, direction },
  }) satisfies Operation;

/** The toolpath of `operation` on the top side and on the bottom side, flipped about `flipAxis`. */
function bothSides(operation: Operation, flipAxis: FlipAxis): [Toolpath, Toolpath] {
  const doc = fullDocument();
  const document: ProjectDocument = {
    ...doc,
    stock: {
      ...doc.stock,
      ...STOCK,
      touchOff: null,
      twoSided: { flipAxis, partingDepth: 9, tabs: null, lineUp: null },
    },
    geometry: [ELL, HOLE],
    models: [],
    fonts: [],
    operations: [operation, { ...operation, id: crypto.randomUUID(), stockSide: "bottom" }],
  };
  const [top, bottom] = toolpathInputs(document).map((input) => generateToolpath(input));
  return [top as Toolpath, bottom as Toolpath];
}

const flip = (axis: FlipAxis) => ({ ...STOCK, axis });

/** The box around a toolpath's points at full depth, seen from above. */
function deepBox(toolpath: Toolpath, map = (point: [number, number]) => point) {
  const points = toolpath.moves
    .filter(({ to }) => Math.abs(to[2] + DEPTH) < 1e-9)
    .map(({ to }) => map([to[0], to[1]]));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The signed area of the cut at full depth: its direction around the shape. */
function deepWinding(toolpath: Toolpath): number {
  const ring = toolpath.moves
    .filter(({ to }) => Math.abs(to[2] + DEPTH) < 1e-9)
    .map(({ to }): [number, number] => [to[0], to[1]]);
  return Math.sign(signedArea(ring));
}

/** Whether the tool cuts above full depth, as over a tab, within 8 mm of `point`. */
function risesNear(toolpath: Toolpath, [x, y]: [number, number]): boolean {
  return toolpath.moves.some(
    ({ kind, to }) =>
      kind !== "rapid" &&
      to[2] > -DEPTH + 1e-6 &&
      to[2] < 0 &&
      Math.hypot(to[0] - x, to[1] - y) < 8,
  );
}

describe("2D operations on the bottom side", () => {
  const axes: FlipAxis[] = ["x", "y"];

  for (const axis of axes) {
    describe(`flipped about ${axis}`, () => {
      it.each([
        ["outside", "climb"],
        ["outside", "conventional"],
        ["inside", "climb"],
        ["inside", "conventional"],
      ] as const)(
        "profiles %s, %s, as on the top side, on the drawing seen from below",
        (side, direction) => {
          const [top, bottom] = bothSides(profile(side, direction), axis);
          expect(bottom.warnings).toEqual(top.warnings);
          expect(bottom.moves).toHaveLength(top.moves.length);
          // Where the top side cuts, mirrored.
          const back = deepBox(bottom, (point) => flipPoint2(flip(axis), point));
          for (const [i, value] of deepBox(top).entries()) expect(back[i]).toBeCloseTo(value, 3);
          // Round the shape the same way as seen by the cutter, so climb stays climb.
          expect(deepWinding(bottom)).toBe(deepWinding(top));
          // As deep below the bottom face as the top side goes below the top.
          const lowest = (toolpath: Toolpath) => Math.min(...toolpath.moves.map(({ to }) => to[2]));
          expect(lowest(bottom)).toBeCloseTo(-DEPTH);
          expect(lowest(top)).toBeCloseTo(-DEPTH);
        },
      );

      it.each(["climb", "conventional"] as const)(
        "pockets the drawing seen from below, %s",
        (direction) => {
          // Its passes may be cleared in another order, so only where they reach is compared.
          const [top, bottom] = bothSides(pocketing(direction), axis);
          const back = deepBox(bottom, (point) => flipPoint2(flip(axis), point));
          for (const [i, value] of deepBox(top).entries()) expect(back[i]).toBeCloseTo(value, 3);
          // The last pass follows the wall, round it the same way as on the top side.
          const wall = (toolpath: Toolpath) => {
            const deep = toolpath.moves.filter(({ to }) => Math.abs(to[2] + DEPTH) < 1e-9);
            const last = deep.slice(-40).map(({ to }): [number, number] => [to[0], to[1]]);
            return Math.sign(signedArea(last));
          };
          expect(wall(bottom)).toBe(wall(top));
        },
      );

      it("drills a hole where the drawing seen from below has it", () => {
        const drilling: Operation = {
          ...base,
          id: crypto.randomUUID(),
          type: "drill",
          tool: drill,
          stockSide: "top",
          targets: [{ shapeId: HOLE.id, paths: null }],
          params: { depth: DEPTH, peck: false, stepOver: 40, pins: false },
        };
        const [, bottom] = bothSides(drilling, axis);
        const plunges = bottom.moves.filter(({ to }) => Math.abs(to[2] + DEPTH) < 1e-9);
        expect(plunges.length).toBeGreaterThan(0);
        const [x, y] = flipPoint2(flip(axis), [150, 30]);
        for (const { to } of plunges) {
          expect(to[0]).toBeCloseTo(x);
          expect(to[1]).toBeCloseTo(y);
        }
      });

      it("engraves the drawing seen from below", () => {
        const engraving: Operation = {
          ...base,
          id: crypto.randomUUID(),
          type: "engrave",
          tool: endMill,
          stockSide: "top",
          params: { side: "on", depth: DEPTH, ramp: false },
        };
        const [top, bottom] = bothSides(engraving, axis);
        expect(bottom.moves).toHaveLength(top.moves.length);
        const back = deepBox(bottom, (point) => flipPoint2(flip(axis), point));
        for (const [i, value] of deepBox(top).entries()) expect(back[i]).toBeCloseTo(value, 6);
      });

      it("leaves the profile's tabs where they are on the part", () => {
        const [top, bottom] = bothSides(profile("outside", "climb", true), axis);
        // The tool rises over the tab where the drawing has it, mirrored on the bottom side.
        expect(risesNear(top, [45, 10])).toBe(true);
        expect(risesNear(bottom, flipPoint2(flip(axis), [45, 10]))).toBe(true);
        expect(risesNear(bottom, [45, 10])).toBe(false);
      });
    });
  }
});
