import { ballEndMill, endMill } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import {
  expectFeedsAboveModel,
  finishing,
  PYRAMID,
  pyramidMesh,
  reliefOptions,
  SAMPLING,
  segmentsOf,
  TWIN,
  twinMesh,
} from "../link-test-utils";
import type { Toolpath } from "../toolpath";
import { runSteps } from "./finish";
import { reliefFinishSteps } from "./finishing";

// The feeds spiral finishing makes without retracting (#574): from each run
// straight on into the next, and across the gaps rest machining leaves.

const spiral = (start: "outside" | "centre") => ({ type: "spiral", start }) as const;

const rapids = ({ moves }: Toolpath) => moves.filter(({ kind }) => kind === "rapid").length;

describe("spiral links", () => {
  for (const [label, tool, tolerance] of [
    ["a ball end mill", ballEndMill, 0.005],
    ["a flat end mill", endMill, SAMPLING],
  ] as const) {
    for (const start of ["outside", "centre"] as const) {
      it(`goes on from run to run without going into the model, from the ${start}, with ${label}`, () => {
        for (const [model, mesh] of [
          [PYRAMID, pyramidMesh],
          [TWIN, twinMesh],
        ] as const) {
          const toolpath = runSteps(
            reliefFinishSteps(finishing(tool, spiral(start)), model, mesh, reliefOptions),
          );
          // Down once and up once: every run joined to the one before.
          expect(rapids(toolpath)).toBe(3);
          expectFeedsAboveModel(toolpath, tool, model, mesh, tolerance);
        }
      });
    }
  }

  it("joins and retracts across the runs rest machining leaves without going into the model", () => {
    const first = runSteps(
      reliefFinishSteps(finishing(ballEndMill, spiral("outside")), TWIN, twinMesh, reliefOptions),
    );
    // Earlier cuts over the left pyramid only.
    const all = segmentsOf(first);
    const left: number[] = [];
    for (let i = 0; i + 5 < all.length; i += 6) {
      if ((all[i] as number) < 15 && (all[i + 3] as number) < 15)
        left.push(...all.subarray(i, i + 6));
    }
    const toolpath = runSteps(
      reliefFinishSteps(finishing(ballEndMill, spiral("outside"), { rest: true }), TWIN, twinMesh, {
        ...reliefOptions,
        rest: { cuts: [{ tool: ballEndMill, segments: new Float32Array(left) }], stock: null },
      }),
    );
    // Each lap crosses the cut half and back: more than one way in.
    expect(rapids(toolpath)).toBeGreaterThan(3);
    expect(toolpath.moves.length).toBeLessThan(first.moves.length);
    expectFeedsAboveModel(toolpath, ballEndMill, TWIN, twinMesh, 0.005);
  });
});
