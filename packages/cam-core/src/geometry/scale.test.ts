import { type Point, Shape, type TextSettings } from "@furrow/document";
import { square, textItem } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { shapesBounds } from "./bounds";
import { mapShapes, mapText, mirrorPoint, rotatePoint, scalePoint, scaleShapes } from "./scale";
import { translatePoint } from "./translate";

describe("scalePoint", () => {
  it("scales about `from` and lands it on `to`, rounding float noise", () => {
    expect(scalePoint([10, 20], 2, [10, 20], [10, 20])).toEqual([10, 20]);
    expect(scalePoint([20, 20], 2, [10, 20], [10, 20])).toEqual([30, 20]);
    expect(scalePoint([20, 20], 0.5, [10, 20], [0, 0])).toEqual([5, 0]);
    expect(scalePoint([0.3, 0], 1 / 3, [0, 0], [0, 0])).toEqual([0.1, 0]);
  });
});

describe("scaleShapes", () => {
  const shape: Shape = {
    ...square,
    paths: [
      {
        start: [0, 0],
        segments: [
          { kind: "line", to: [10, 0] },
          { kind: "arc", to: [0, 10], center: [0, 0], clockwise: false },
          { kind: "cubic", c1: [-5, 10], c2: [-5, 0], to: [0, 0] },
        ],
        closed: true,
      },
    ],
  };

  it("scales every point, arc centres and cubic control points included, keeping arcs' direction", () => {
    expect(scaleShapes([shape], 2, [0, 0], [1, 1])).toEqual([
      {
        ...shape,
        paths: [
          {
            start: [1, 1],
            segments: [
              { kind: "line", to: [21, 1] },
              { kind: "arc", to: [1, 21], center: [1, 1], clockwise: false },
              { kind: "cubic", c1: [-9, 21], c2: [-9, 1], to: [1, 1] },
            ],
            closed: true,
          },
        ],
      },
    ]);
  });

  it("keeps the shapes valid and their proportions", () => {
    const [scaled] = scaleShapes([square], 1.7, [0, 0], [0, 0]);
    expect(Shape.parse(scaled)).toEqual(scaled);
    const before = shapesBounds([square]);
    const after = shapesBounds(scaleShapes([square], 1.7, [0, 0], [0, 0]));
    if (!before || !after) throw new Error("bounds");
    expect(after.max[0] / after.max[1]).toBeCloseTo(before.max[0] / before.max[1], 9);
  });
});

describe("rotatePoint", () => {
  it("turns counter-clockwise about a point, rounding float noise", () => {
    expect(rotatePoint([10, 0], 90, [0, 0])).toEqual([0, 10]);
    expect(rotatePoint([10, 0], -90, [0, 0])).toEqual([0, -10]);
    expect(rotatePoint([12, 5], 180, [10, 5])).toEqual([8, 5]);
    const [x, y] = rotatePoint([10, 0], 30, [0, 0]);
    expect(Math.hypot(x, y)).toBeCloseTo(10, 9);
    expect(Math.atan2(y, x)).toBeCloseTo(Math.PI / 6, 9);
  });
});

describe("mirrorPoint", () => {
  it("flips across the line through the point", () => {
    expect(mirrorPoint([12, 7], "x", [10, 0])).toEqual([8, 7]);
    expect(mirrorPoint([12, 7], "y", [0, 5])).toEqual([12, 3]);
  });
});

describe("mapShapes", () => {
  const arc: Shape = {
    ...square,
    paths: [
      {
        start: [10, 0],
        segments: [
          { kind: "arc", to: [0, 10], center: [0, 0], clockwise: false },
          { kind: "cubic", c1: [-5, 10], c2: [-5, 0], to: [10, 0] },
        ],
        closed: true,
      },
    ],
  };

  it("flips arcs when mirrored, keeping centre and radius, and moves cubics' control points", () => {
    const [mirrored] = mapShapes([arc], (point) => mirrorPoint(point, "x", [0, 0]), true);
    expect(mirrored?.paths[0]).toEqual({
      start: [-10, 0],
      segments: [
        { kind: "arc", to: [0, 10], center: [0, 0], clockwise: true },
        { kind: "cubic", c1: [5, 10], c2: [5, 0], to: [-10, 0] },
      ],
      closed: true,
    });
    expect(Shape.parse(mirrored)).toEqual(mirrored);
  });

  it("keeps arcs' direction when rotated, by any angle", () => {
    const [turned] = mapShapes([arc], (point) => rotatePoint(point, 37, [3, 4]));
    expect(Shape.parse(turned)).toEqual(turned);
    expect(turned?.paths[0]?.segments[0]).toMatchObject({ kind: "arc", clockwise: false });
  });
});

describe("mapText", () => {
  const text = textItem.text as TextSettings;
  const turned: TextSettings = {
    ...text,
    placement: { position: [30, 20], rotation: 30, mirrored: true },
  };

  /** Where `[x, y]` of the text's layout, at `text`'s height, lies in the stock after `settings`. */
  function place(settings: TextSettings, [x, y]: Point): Point {
    const { position, rotation, mirrored } = settings.placement;
    const k = settings.height / text.height;
    const radians = (rotation * Math.PI) / 180;
    const lx = (mirrored ? -x : x) * k;
    const ly = y * k;
    return [
      position[0] + lx * Math.cos(radians) - ly * Math.sin(radians),
      position[1] + lx * Math.sin(radians) + ly * Math.cos(radians),
    ];
  }

  const moves: [string, (point: Point) => Point][] = [
    ["a translation", (point) => translatePoint(point, [5, -3])],
    ["a scale", (point) => scalePoint(point, 2.5, [0, 0], [10, 10])],
    ["a turn", (point) => rotatePoint(point, 90, [50, 50])],
    ["a mirror left to right", (point) => mirrorPoint(point, "x", [50, 50])],
    ["a mirror top to bottom", (point) => mirrorPoint(point, "y", [50, 50])],
  ];

  it.each(moves)("places the layout where %s moves the outlines", (_, move) => {
    for (const settings of [text, turned]) {
      const mapped = mapText(settings, move);
      for (const point of [
        [0, 0],
        [7, 0],
        [3, 10],
      ] as Point[]) {
        const [x, y] = move(place(settings, point));
        const [px, py] = place(mapped, point);
        expect(px).toBeCloseTo(x, 6);
        expect(py).toBeCloseTo(y, 6);
      }
    }
  });

  it("scales the letter spacing with the height, so laying it out again gives the same outlines", () => {
    const spaced = { ...text, letterSpacing: 2 };
    expect(mapText(spaced, (point) => scalePoint(point, 2.5, [0, 0], [0, 0]))).toMatchObject({
      height: 25,
      letterSpacing: 5,
      lineSpacing: text.lineSpacing,
    });
    expect(mapText(spaced, (point) => rotatePoint(point, 90, [0, 0])).letterSpacing).toBe(2);
  });

  it("refuses a move that scales x and y differently", () => {
    expect(() => mapText(text, ([x, y]) => [x * 2, y])).toThrow("proportions");
  });

  it("keeps the rotation in [0, 360) and drops float noise", () => {
    const back = (point: Point) => rotatePoint(point, -30, [0, 0]);
    expect(mapText(turned, back).placement).toEqual({
      position: rotatePoint([30, 20], -30, [0, 0]),
      rotation: 0,
      mirrored: true,
    });
    expect(mapText(text, (point) => rotatePoint(point, -90, [0, 0])).placement.rotation).toBe(270);
    expect(mapText(text, (point) => scalePoint(point, 0.1, [0, 0], [0, 0])).height).toBe(1);
  });
});
