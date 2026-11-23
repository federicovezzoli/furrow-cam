import type { Model, Path, Point } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { circleCenter } from "../geometry/circle";
import { signedArea } from "../geometry/clipper";
import { flattenPath } from "../geometry/flatten";
import { triangulate } from "../geometry/triangulate";
import { modelFlatFaces } from "./flat-faces";

type Vec3 = [number, number, number];
type Triangle = [Vec3, Vec3, Vec3];

/** Triangles covering `outer` less `holes` at height `z`, facing up. */
function flatFace(z: number, outer: Point[], holes: Point[][] = []): Triangle[] {
  const points = [outer, ...holes].flat();
  const indices = triangulate(outer, holes);
  const triangles: Triangle[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    let corners = [indices[i], indices[i + 1], indices[i + 2]].map(
      (k) => points[k as number] as Point,
    );
    if (signedArea(corners) < 0) corners = corners.reverse();
    triangles.push(corners.map(([x, y]): Vec3 => [x, y, z]) as Triangle);
  }
  return triangles;
}

function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** A circle as a 32-gon, its vertices on it, as a mesher tessellates a hole. */
function circle([cx, cy]: Point, radius: number): Point[] {
  return Array.from({ length: 32 }, (_, i): Point => {
    const angle = (i / 32) * 2 * Math.PI;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}

const HOLES: Point[] = [
  [6, 6],
  [94, 6],
  [6, 54],
  [94, 54],
];
const POCKET = rect(10, 10, 40, 50);
const STEP = rect(60, 10, 90, 50);

/**
 * The 2.5D test part of #665, as its faces: a 100 × 60 × 12 mm plate with a
 * pocket 6 mm deep, a step 3 mm deep and four Ø6 through holes. Its upward
 * faces are meshed; of the rest, a wall and the bottom, which no level takes.
 */
const PLATE: Triangle[][] = [
  flatFace(12, rect(0, 0, 100, 60), [POCKET, STEP, ...HOLES.map((c) => circle(c, 3))]),
  flatFace(9, STEP),
  flatFace(6, POCKET),
  [
    [
      [0, 0, 0],
      [100, 0, 0],
      [100, 0, 12],
    ],
  ],
  flatFace(0, rect(0, 0, 100, 60)).map((t) => [t[0], t[2], t[1]] as Triangle),
];

function mesh(faces: Triangle[][]): Float32Array {
  return new Float32Array(faces.flat(3));
}

const PLACED: Pick<Model, "bounds" | "placement"> = {
  bounds: { min: [0, 0, 0], max: [100, 60, 12] },
  placement: { rotation: [0, 0, 0], scale: 1, depth: 12, top: 0, position: [0, 0] },
};

function bounds(paths: Path[]) {
  const points = paths.flatMap((path) => flattenPath(path));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe("modelFlatFaces", () => {
  it("finds each flat level of a 2.5D part, from the top down, and its outline", () => {
    const { levels, outline } = modelFlatFaces(mesh(PLATE), PLACED);
    expect(levels.map(({ z }) => z)).toEqual([0, -3, -6]);

    const [top, step, pocket] = levels;
    // The plate's outline, the pocket's and the step's openings, and the four holes.
    expect(top?.paths).toHaveLength(7);
    expect(step?.paths).toHaveLength(1);
    expect(bounds(step?.paths ?? [])).toEqual([60, 10, 90, 50]);
    expect(bounds(pocket?.paths ?? [])).toEqual([10, 10, 40, 50]);

    // One closed ring around the whole plate, without its holes.
    expect(outline).toHaveLength(1);
    expect(bounds(outline)).toEqual([0, 0, 100, 60]);
  });

  it("turns tessellated holes into circles a drill operation takes", () => {
    const [top] = modelFlatFaces(mesh(PLATE), PLACED).levels;
    const circles = (top?.paths ?? []).filter(({ segments }) => segments[0]?.kind === "arc");
    expect(circles.map((path) => circleCenter(path))).toEqual(expect.arrayContaining(HOLES));
    expect(circles).toHaveLength(HOLES.length);
    for (const { start, segments } of circles) {
      const arc = segments[0];
      if (arc?.kind !== "arc") throw new Error("not an arc");
      expect(Math.hypot(start[0] - arc.center[0], start[1] - arc.center[1])).toBeCloseTo(3, 3);
    }
  });

  it("places the levels where the model is placed", () => {
    const placement = { ...PLACED.placement, scale: 0.5, depth: 6, top: 2, position: [20, 30] };
    const { levels } = modelFlatFaces(mesh(PLATE), { ...PLACED, placement } as typeof PLACED);
    expect(levels.map(({ z }) => z)).toEqual([-2, -3.5, -5]);
    expect(bounds(levels[2]?.paths ?? [])).toEqual([25, 35, 40, 55]);
  });

  it("takes a STEP file's faces whole: a face is a level only if all of it is flat", () => {
    // A shallow ramp of two triangles, each flat on its own but at another height.
    const ramp: Triangle[][] = [
      [
        [
          [0, 0, 12],
          [10, 0, 12],
          [10, 10, 12],
        ],
        [
          [0, 0, 11],
          [10, 10, 11],
          [0, 10, 11],
        ],
      ],
    ];
    const faces = [...PLATE, ...ramp];
    const counts = faces.map((face) => face.length);
    expect(modelFlatFaces(mesh(faces), PLACED).levels.map(({ z }) => z)).toEqual([0, -1, -3, -6]);
    expect(
      modelFlatFaces(mesh(faces), { ...PLACED, faces: counts }).levels.map(({ z }) => z),
    ).toEqual([0, -3, -6]);
  });

  it("leaves out levels too small to machine", () => {
    const speck = flatFace(12, rect(200, 200, 200.5, 200.5));
    expect(modelFlatFaces(mesh([speck]), PLACED)).toEqual({
      levels: [],
      outline: [expect.objectContaining({ closed: true })],
    });
  });

  it("finds nothing on a model with no upward face", () => {
    const down = flatFace(0, rect(0, 0, 10, 10)).map((t) => [t[0], t[2], t[1]] as Triangle);
    expect(modelFlatFaces(mesh([down]), PLACED)).toEqual({ levels: [], outline: [] });
  });
});
