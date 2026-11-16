import type { Model, Tool } from "@furrow/document";
import { ballEndMill, endMill } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import {
  expectFeedsAboveModel,
  finishing,
  lifts,
  PYRAMID,
  pyramidMesh,
  RIDGE,
  reliefOptions,
  ridgeMesh,
  SAMPLING,
  STEP,
  stepMesh,
  TWIN,
  twinMesh,
} from "../link-test-utils";
import type { Toolpath } from "../toolpath";
import { runSteps } from "./finish";
import { reliefFinishSteps } from "./finishing";

// The feeds waterline finishing makes without retracting (#574): from one
// contour to the next, and down from one level to the next.

const waterline = (stepDown: number) => ({ type: "waterline", stepDown }) as const;

function finish(tool: Tool, model: Model, mesh: Float32Array, stepDown: number): Toolpath {
  return runSteps(
    reliefFinishSteps(finishing(tool, waterline(stepDown)), model, mesh, reliefOptions),
  );
}

describe("waterline links", () => {
  it("feeds down from level to level along a wall without going into the model", () => {
    // Contours along the wall, a level apart and right above each other: well within reach.
    const toolpath = finish(endMill, STEP, stepMesh, 1);
    expect(expectFeedsAboveModel(toolpath, endMill, STEP, stepMesh, 0.005)).toBeGreaterThanOrEqual(
      4,
    );
    expect(lifts(toolpath)).toBeLessThanOrEqual(2);
  });

  it("retracts over a ridge between contours in reach rather than feeding through it", () => {
    // Below the ridge, a contour either side of it, 10.35 mm apart: in the
    // flat end mill's 12.7 mm reach, but the straight way is through the ridge.
    const toolpath = finish(endMill, RIDGE, ridgeMesh, 1);
    expectFeedsAboveModel(toolpath, endMill, RIDGE, ridgeMesh, 0.005);
    const levels = new Set(
      toolpath.moves.filter(({ kind, to }) => kind === "feed" && to[2] < -2).map(({ to }) => to[2]),
    );
    expect(levels.size).toBe(6);
    // Each time the tool leaves the cut below the ridge, from one side of it, where it comes back down.
    const { moves } = toolpath;
    const sides = moves.flatMap((move, i) => {
      const from = moves[i - 1]?.to;
      if (!from || from[2] >= -2 || move.kind !== "rapid" || move.to[2] <= from[2]) return [];
      const back = moves.slice(i).find(({ kind }) => kind !== "rapid")?.to;
      return back ? [[from[0] < 12, back[0] < 12]] : [];
    });
    // Over the ridge once on each of the six levels below it.
    expect(sides.filter(([from, back]) => from !== back)).toHaveLength(levels.size);
  });

  it("retracts between contours out of reach, never feeding through the model", () => {
    // Around two pyramids, the 3 mm ball end mill's reach is less than the valley between them.
    const toolpath = finish(ballEndMill, TWIN, twinMesh, 1);
    expectFeedsAboveModel(toolpath, ballEndMill, TWIN, twinMesh, 0.005);
    const levels = new Set(
      toolpath.moves.filter(({ kind, to }) => kind === "feed" && to[2] < -4).map(({ to }) => to[2]),
    );
    // From one pyramid to the other at least once on each level around them.
    expect(levels.size).toBe(4);
    expect(lifts(toolpath)).toBeGreaterThanOrEqual(levels.size);
  });

  it("goes from level to level down a pyramid without going into the model", () => {
    // Contours half a millimetre apart in height on faces rising 0.8 in 1.
    for (const tool of [ballEndMill, endMill]) {
      const tolerance = tool === ballEndMill ? 0.005 : SAMPLING;
      expectFeedsAboveModel(
        finish(tool, PYRAMID, pyramidMesh, 0.5),
        tool,
        PYRAMID,
        pyramidMesh,
        tolerance,
      );
    }
  }, 20_000);

  it("links the runs rest machining leaves without going into the model", () => {
    // Earlier cuts along the wall's contours at both ends only, as far as y = 3 and from y = 7.
    const x = 10 + endMill.diameter / 2;
    const segments: number[] = [];
    for (let z = -5; z >= -10; z--) segments.push(x, 0, z, x, 3, z, x, 7, z, x, 10, z);
    const toolpath = runSteps(
      reliefFinishSteps(finishing(endMill, waterline(1), { rest: true }), STEP, stepMesh, {
        ...reliefOptions,
        rest: { cuts: [{ tool: endMill, segments: new Float32Array(segments) }], stock: null },
      }),
    );
    const middle = toolpath.moves.filter(
      ({ kind, to }) => kind === "feed" && to[1] > 3.5 && to[1] < 6.5 && to[2] < -4.5,
    );
    expect(middle.length).toBeGreaterThan(0);
    expectFeedsAboveModel(toolpath, endMill, STEP, stepMesh, 0.005);
  });
});
