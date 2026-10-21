import { generateToolpath, toolpathInput } from "@furrow/cam-core";
import {
  createProjectDocument,
  type Path,
  type ProfileSide,
  type Segment,
  type Shape,
} from "@furrow/document";
import { DRAWING_ID, drill, endMill, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import {
  addDrillOperation,
  addPocketOperation,
  addProfileOperation,
  addVCarveOperation,
  updateProfileParams,
} from "./operation-actions";

/**
 * Mirroring a drawing reverses its paths' winding (ADR-0055): toolpaths must
 * cut the same whichever way round a path is drawn.
 */

const OUTLINE = "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b";
const HOLE = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

/** An 80 mm square with a rounded corner, drawn counter-clockwise and back to its start. */
const outline: Path = {
  start: [20, 20],
  segments: [
    { kind: "line", to: [100, 20] },
    { kind: "line", to: [100, 80] },
    { kind: "arc", to: [80, 100], center: [80, 80], clockwise: false },
    { kind: "line", to: [20, 100] },
    { kind: "line", to: [20, 20] },
  ],
  closed: true,
};
/** A 6 mm hole, drawn as two counter-clockwise half circles. */
const hole: Path = {
  start: [63, 60],
  segments: [
    { kind: "arc", to: [57, 60], center: [60, 60], clockwise: false },
    { kind: "arc", to: [63, 60], center: [60, 60], clockwise: false },
  ],
  closed: true,
};

/** `path` drawn the other way round, ending where it starts. */
function reversed(path: Path): Path {
  const points = [path.start, ...path.segments.map((segment) => segment.to)];
  const segments = path.segments
    .map((segment, i): Segment => {
      const to = points[i] as Path["start"];
      if (segment.kind === "line") return { kind: "line", to };
      if (segment.kind === "arc") return { ...segment, to, clockwise: !segment.clockwise };
      return { kind: "cubic", c1: segment.c2, c2: segment.c1, to };
    })
    .reverse();
  return { start: points.at(-1) as Path["start"], segments, closed: path.closed };
}

function shapes(flip: (path: Path) => Path): Shape[] {
  const shape = (id: string, path: Path): Shape => ({
    id,
    name: "",
    layer: "0",
    drawingId: DRAWING_ID,
    paths: [flip(path)],
  });
  return [shape(OUTLINE, outline), shape(HOLE, hole)];
}

type Add = typeof addProfileOperation;

/** Where an operation cuts: the box of its feed moves, depth included, to a micrometre. */
function cutBox(flip: (path: Path) => Path, add: Add, tool = endMill, side?: ProfileSide) {
  const store = createDocumentStore({
    ...createProjectDocument(),
    drawings: [{ id: DRAWING_ID, name: "part.svg", border: 10 }],
    geometry: shapes(flip),
  });
  const targets = [OUTLINE, HOLE].map((shapeId) => ({ shapeId, paths: null }));
  const id = add(store, { targets, tool });
  if (!id) throw new Error("operation not added");
  if (side) updateProfileParams(store, id, { side });
  const { moves } = generateToolpath(toolpathInput(store.getState().document, id));
  const feeds = moves.filter((move) => move.kind === "feed").map((move) => move.to);
  expect(feeds.length).toBeGreaterThan(0);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [0, 1, 2].map((axis) => [
    round(Math.min(...feeds.map((point) => point[axis] as number))),
    round(Math.max(...feeds.map((point) => point[axis] as number))),
  ]);
}

const same = (path: Path) => path;

describe("toolpaths don't depend on paths' winding", () => {
  it.each(["outside", "inside", "on"] as const)("profile %s", (side) => {
    expect(cutBox(reversed, addProfileOperation, endMill, side)).toEqual(
      cutBox(same, addProfileOperation, endMill, side),
    );
  });

  it("pocket", () => {
    expect(cutBox(reversed, addPocketOperation)).toEqual(cutBox(same, addPocketOperation));
  });

  it("V-carve", () => {
    expect(cutBox(reversed, addVCarveOperation, vBit)).toEqual(
      cutBox(same, addVCarveOperation, vBit),
    );
  });

  it("drill", () => {
    expect(cutBox(reversed, addDrillOperation, drill)).toEqual(
      cutBox(same, addDrillOperation, drill),
    );
  });

  it("tells a profile's sides apart, so a winding mix-up would show", () => {
    expect(cutBox(same, addProfileOperation, endMill, "outside")).not.toEqual(
      cutBox(same, addProfileOperation, endMill, "inside"),
    );
  });

  it("reverses the paths it is given", () => {
    expect(reversed(reversed(outline))).toEqual(outline);
  });
});
