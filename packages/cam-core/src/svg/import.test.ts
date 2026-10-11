import { type Path, type Point, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { flattenPath } from "../flatten";
import affinity from "./fixtures/affinity.svg?raw";
import illustrator from "./fixtures/illustrator.svg?raw";
import illustratorLegacy from "./fixtures/illustrator-legacy.svg?raw";
import inkscape from "./fixtures/inkscape.svg?raw";
import { importSvg, MAX_SVG_ELEMENTS, parseSvg, SvgImportError, svgNeedsDpi } from "./import";

function bounds(paths: Path[]): { min: Point; max: Point } {
  const points = paths.flatMap((path) => flattenPath(path));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

function expectBounds(paths: Path[], min: Point, max: Point, digits = 6) {
  const box = bounds(paths);
  expect(box.min[0]).toBeCloseTo(min[0], digits);
  expect(box.min[1]).toBeCloseTo(min[1], digits);
  expect(box.max[0]).toBeCloseTo(max[0], digits);
  expect(box.max[1]).toBeCloseTo(max[1], digits);
}

/** A document with a 100 × 50 mm page, 1 user unit per millimetre. */
function svg(body: string, root = 'width="100mm" height="50mm" viewBox="0 0 100 50"') {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`;
}

function importOne(body: string) {
  const { shapes } = importSvg(svg(body));
  expect(shapes).toHaveLength(1);
  return shapes[0] as Shape;
}

describe("importSvg", () => {
  it("flips y so the page's bottom-left corner is the stock's", () => {
    const shape = importOne('<path d="M0 0 L10 0"/>');
    expect(shape.paths[0]).toEqual({
      start: [0, 50],
      segments: [{ kind: "line", to: [10, 50] }],
      closed: false,
    });
  });

  it.each([
    ["millimetres", 'width="100mm" height="50mm" viewBox="0 0 100 50"', 10],
    ["centimetres", 'width="10cm" height="5cm" viewBox="0 0 1000 500"', 1],
    ["inches", 'width="1in" height="1in" viewBox="0 0 100 100"', 2.54],
    ["points", 'width="72pt" height="72pt" viewBox="0 0 72 72"', 25.4 / 7.2],
    ["pixels at the default 96 DPI", 'width="96px" height="96px"', 25.4 / 9.6],
    ["unitless sizes as pixels", 'width="96" height="96"', 25.4 / 9.6],
    ["a viewBox alone, in pixels", 'viewBox="0 0 96 96"', 25.4 / 9.6],
    ["no sizes at all, in pixels", "", 25.4 / 9.6],
  ])("reads %s", (_, root, length) => {
    const path = importSvg(svg('<path d="M0 0 H10"/>', root)).shapes[0]?.paths[0];
    expect(path?.segments[0]?.to[0]).toBeCloseTo(length, 9);
  });

  it("reads pixels at the given DPI", () => {
    const { shapes } = importSvg(svg('<path d="M0 0 H72"/>', 'width="72" height="72"'), {
      dpi: 72,
    });
    const [path] = shapes[0]?.paths ?? [];
    expect(path?.segments[0]?.to[0]).toBeCloseTo(25.4, 9);
    expect(path?.start[1]).toBeCloseTo(25.4, 9);
  });

  it("derives a missing width or height from the viewBox's aspect ratio", () => {
    const { shapes } = importSvg(
      svg('<path d="M0 100 H200"/>', 'width="20mm" viewBox="0 0 200 100"'),
    );
    expect(shapes[0]?.paths[0]?.start).toEqual([0, 0]);
    expect(shapes[0]?.paths[0]?.segments[0]?.to[0]).toBeCloseTo(20, 9);
  });

  it("offsets by the viewBox origin", () => {
    const shape = importSvg(
      svg('<path d="M10 20 H20"/>', 'width="100mm" height="50mm" viewBox="10 20 100 50"'),
    ).shapes[0];
    expect(shape?.paths[0]?.start).toEqual([0, 50]);
  });

  it("centres a viewBox of another aspect ratio, as preserveAspectRatio's default does", () => {
    // 50 × 50 units on a 100 × 50 mm page: 1 mm per unit, 25 mm margins left and right.
    const root = 'width="100mm" height="50mm" viewBox="0 0 50 50"';
    expect(importSvg(svg('<path d="M0 50 H1"/>', root)).shapes[0]?.paths[0]?.start).toEqual([
      25, 0,
    ]);
    const stretched = `${root} preserveAspectRatio="none"`;
    expect(importSvg(svg('<path d="M0 50 H1"/>', stretched)).shapes[0]?.paths[0]?.start).toEqual([
      0, 0,
    ]);
    const left = `${root} preserveAspectRatio="xMinYMax meet"`;
    expect(importSvg(svg('<path d="M0 50 H1"/>', left)).shapes[0]?.paths[0]?.start).toEqual([0, 0]);
  });

  it("rests a drawing with no page size on the stock's bottom edge", () => {
    const { shapes, warnings } = importSvg(
      svg('<path d="M0 -30 H10"/><path d="M0 -10 H10"/>', 'viewBox="0 0 0 0"'),
      { dpi: 25.4 },
    );
    expect(shapes.map((shape) => shape.paths[0]?.start)).toEqual([
      [0, 20],
      [0, 0],
    ]);
    expect(warnings).toEqual([expect.stringContaining("no page size")]);
  });

  it("applies nested transforms", () => {
    const shape = importOne(
      '<g transform="translate(10 0)"><path transform="scale(2)" d="M0 25 H5"/></g>',
    );
    expect(shape.paths[0]?.start).toEqual([10, 0]);
    expect(shape.paths[0]?.segments[0]?.to).toEqual([20, 0]);
  });

  it("keeps circles as arcs, drawn clockwise as on screen", () => {
    const shape = importOne('<circle cx="20" cy="25" r="5"/>');
    expect(shape.paths).toEqual([
      {
        start: [25, 25],
        segments: [{ kind: "arc", to: [25, 25], center: [20, 25], clockwise: true }],
        closed: true,
      },
    ]);
  });

  it("keeps circles under rotations, uniform scales and mirrors as arcs", () => {
    const shape = importOne('<circle transform="rotate(30) scale(-2 2)" cx="20" cy="10" r="5"/>');
    const [segment] = shape.paths[0]?.segments ?? [];
    expect(segment?.kind).toBe("arc");
    if (segment?.kind !== "arc") return;
    expect(
      Math.hypot(segment.to[0] - segment.center[0], segment.to[1] - segment.center[1]),
    ).toBeCloseTo(10, 9);
    expect(segment.clockwise).toBe(false);
  });

  it("turns ellipses, and circles under a stretch, into cubics", () => {
    for (const body of [
      '<ellipse cx="50" cy="25" rx="20" ry="10"/>',
      '<circle transform="translate(50 25) scale(2 1)" r="10"/>',
    ]) {
      const shape = importOne(body);
      expect(shape.paths[0]?.segments.map((s) => s.kind)).toEqual([
        "cubic",
        "cubic",
        "cubic",
        "cubic",
      ]);
      expect(shape.paths[0]?.closed).toBe(true);
      expectBounds(shape.paths, [30, 15], [70, 35], 3);
    }
  });

  it("imports rects, rounding their corners with rx or ry alone", () => {
    expectBounds(
      importOne('<rect x="10" y="10" width="30" height="20"/>').paths,
      [10, 20],
      [40, 40],
    );
    const rounded = importOne('<rect x="10" y="10" width="30" height="20" ry="5"/>');
    expect(rounded.paths[0]?.segments.map((s) => s.kind)).toEqual([
      "line",
      "cubic",
      "line",
      "cubic",
      "line",
      "cubic",
      "line",
      "cubic",
    ]);
    expectBounds(rounded.paths, [10, 20], [40, 40], 9);
  });

  it("clamps rounded corners to half the rect, leaving no zero-length lines", () => {
    const pill = importOne('<rect width="40" height="10" rx="5" ry="50"/>');
    // The sides are as long as the rect; the ends are half ellipses.
    expect(pill.paths[0]?.segments.map((s) => s.kind)).toEqual([
      "line",
      "cubic",
      "cubic",
      "line",
      "cubic",
      "cubic",
    ]);
    expect(Shape.safeParse(pill).success).toBe(true);
  });

  it("imports lines, polylines and polygons", () => {
    const { shapes } = importSvg(
      svg(
        '<line x1="0" y1="50" x2="10" y2="40"/>' +
          '<polyline points="0,50 10,50 10,40 5"/>' +
          '<polygon points="0 50, 10 50, 10 40"/>',
      ),
    );
    expect(shapes.map((shape) => shape.paths[0])).toEqual([
      { start: [0, 0], segments: [{ kind: "line", to: [10, 10] }], closed: false },
      {
        start: [0, 0],
        segments: [
          { kind: "line", to: [10, 0] },
          { kind: "line", to: [10, 10] },
        ],
        closed: false,
      },
      {
        start: [0, 0],
        segments: [
          { kind: "line", to: [10, 0] },
          { kind: "line", to: [10, 10] },
        ],
        closed: true,
      },
    ]);
  });

  it("makes one path per subpath, dropping zero-length segments and empty subpaths", () => {
    const shape = importOne(
      '<path d="M0 0 H10 H10.0001 V10 Z M50 20 M20 20 L20 20 Z M30 30 L40 30 Z"/>',
    );
    expect(shape.paths).toEqual([
      {
        start: [0, 50],
        segments: [
          { kind: "line", to: [10, 50] },
          { kind: "line", to: [10.0001, 40] },
        ],
        closed: true,
      },
      // A closed single line would only retrace itself.
      { start: [30, 20], segments: [{ kind: "line", to: [40, 20] }], closed: false },
    ]);
    expect(Shape.safeParse(shape).success).toBe(true);
  });

  it("draws use references with their offset, including symbols", () => {
    const { shapes } = importSvg(
      svg(
        '<defs><path id="tick" d="M0 50 H5"/><symbol id="sym"><path d="M0 50 H1"/></symbol></defs>' +
          '<use href="#tick" x="10"/><use xlink:href="#tick" transform="translate(20 0)"/><use href="#sym" y="-10"/>',
      ),
    );
    expect(shapes.map((shape) => shape.paths[0]?.start)).toEqual([
      [10, 0],
      [20, 0],
      [0, 10],
    ]);
    expect(shapes[0]?.name).toBe("tick");
  });

  it("skips missing references with a warning", () => {
    const { shapes, warnings } = importSvg(svg('<use href="#missing"/>'));
    expect(shapes).toEqual([]);
    expect(warnings).toEqual(["Skipped references to missing elements (1)."]);
  });

  it.each([
    ["a group", '<g id="g"><path d="M0 0 H1"/><use href="#g"/></g>'],
    ["itself", '<path d="M0 0 H1"/><use id="u" href="#u"/>'],
    ["a symbol", '<symbol id="s"><path d="M0 0 H1"/><use href="#s"/></symbol><use href="#s"/>'],
    ["the root", '<path d="M0 0 H1"/><use href="#root"/>'],
  ])("draws nothing for a use that refers back to %s, once", (_, body) => {
    const { shapes, warnings } = importSvg(
      svg(body, 'id="root" width="100mm" height="50mm" viewBox="0 0 100 50"'),
    );
    expect(shapes).toHaveLength(1);
    expect(warnings).toEqual(["Skipped circular references (1)."]);
  });

  it("stops at an element budget when references fan out", () => {
    let defs = '<path id="p0" d="M0 0 H1"/>';
    for (let i = 1; i <= 20; i++)
      defs += `<g id="p${i}"><use href="#p${i - 1}"/><use href="#p${i - 1}"/></g>`;
    let next = 0;
    const createId = () => String(next++);
    const { shapes, warnings } = importSvg(svg(`<defs>${defs}</defs><use href="#p20"/>`), {
      createId,
    });
    expect(shapes.length).toBeLessThan(MAX_SVG_ELEMENTS);
    expect(warnings).toEqual([expect.stringContaining("more than 200,000 elements")]);
  });

  it("skips elements with relative or invalid positions instead of importing NaN", () => {
    const { shapes, warnings } = importSvg(
      svg(
        '<svg x="10%"><path d="M0 0 H1"/></svg>' +
          '<defs><path id="a" d="M0 0 H1"/></defs><use href="#a" x="50%"/><use href="#a" y="oops"/>',
      ),
    );
    expect(shapes).toEqual([]);
    expect(warnings).toEqual(["Skipped elements with invalid or relative (%) positions (3)."]);
  });

  it("skips shapes whose coordinates overflow", () => {
    const { shapes, warnings } = importSvg(svg('<path d="M0 0 H1e400"/><path d="M0 0 H1"/>'));
    expect(shapes).toHaveLength(1);
    expect(warnings).toEqual(["Skipped shapes with coordinates too large to import (1)."]);
  });

  it("maps a nested svg's viewBox onto its viewport", () => {
    const shape = importOne(
      '<svg x="10" width="20" height="10" viewBox="0 0 2 1"><path d="M0 1 H2"/></svg>',
    );
    expect(shape.paths[0]).toEqual({
      start: [10, 40],
      segments: [{ kind: "line", to: [30, 40] }],
      closed: false,
    });
  });

  it("sizes a symbol's and an svg's viewport by the use that draws it", () => {
    const { shapes } = importSvg(
      svg(
        '<defs><symbol id="s" viewBox="0 0 1 1"><path d="M0 0 H1"/></symbol>' +
          '<svg id="v" width="1" height="1" viewBox="0 0 1 1"><path d="M0 0 H1"/></svg></defs>' +
          '<use href="#s" x="5" width="10" height="10"/><use href="#v" width="20" height="20"/>',
      ),
    );
    expect(shapes.map((shape) => shape.paths[0]?.segments[0]?.to)).toEqual([
      [15, 50],
      [20, 50],
    ]);
  });

  it("warns about nested viewports whose size it can't tell", () => {
    const { shapes, warnings } = importSvg(
      svg(
        '<svg viewBox="0 0 1 1"><path d="M0 0 H1"/></svg>' +
          '<defs><symbol id="s" viewBox="0 0 1 1"><path d="M0 0 H1"/></symbol></defs><use href="#s"/>',
      ),
    );
    expect(shapes).toEqual([]);
    expect(warnings).toEqual(["Skipped nested viewports with relative (%) or missing sizes (2)."]);
  });

  it("takes a parsed document, so a file is parsed once", () => {
    const document = parseSvg(svg('<path d="M0 0 H1"/>'));
    expect(svgNeedsDpi(document)).toBe(false);
    expect(importSvg(document).shapes).toHaveLength(1);
  });

  it("skips hidden elements, definitions and non-geometry content, warning about what it can't import", () => {
    const { shapes, warnings } = importSvg(
      svg(
        '<path display="none" d="M0 0 H1"/><g style="fill:red; display : none"><path d="M0 0 H1"/></g>' +
          '<defs><path d="M0 0 H1"/></defs><clipPath><rect width="5" height="5"/></clipPath>' +
          '<metadata/><title>t</title><text>a</text><text>b</text><image href="x.png"/>',
      ),
    );
    expect(shapes).toEqual([]);
    expect(warnings).toEqual([
      "Skipped text (convert it to paths before exporting) (2).",
      "Skipped images (1).",
    ]);
  });

  it("warns about shapes with relative sizes and keeps the rest", () => {
    const { shapes, warnings } = importSvg(svg('<rect width="50%" height="10"/><circle r="5"/>'));
    expect(shapes).toHaveLength(1);
    expect(warnings).toEqual([expect.stringContaining("relative (%)")]);
  });

  it("names shapes and layers after Inkscape, Illustrator and Affinity labels", () => {
    const { shapes } = importSvg(
      svg(
        '<g inkscape:groupmode="layer" inkscape:label="Cuts"><g><path inkscape:label="Lid" id="p1" d="M0 0 H1"/></g></g>' +
          '<g id="Layer_1" data-name="Layer 1"><path data-name="Hole" d="M0 0 H1"/></g>' +
          '<g serif:id="Engrave"><g serif:id="Logo"><path d="M0 0 H1"/></g></g>' +
          '<path id="loose" d="M0 0 H1"/>',
      ),
      { fileName: "part.svg" },
    );
    expect(shapes.map(({ name, layer, source }) => ({ name, layer, source }))).toEqual([
      { name: "Lid", layer: "Cuts", source: "part.svg" },
      { name: "Hole", layer: "Layer 1", source: "part.svg" },
      { name: "Logo", layer: "Engrave", source: "part.svg" },
      { name: "loose", layer: "", source: "part.svg" },
    ]);
  });

  it("gives every shape a new id", () => {
    let next = 0;
    const createId = () => `00000000-0000-4000-8000-00000000000${next++}`;
    const { shapes } = importSvg(svg('<path d="M0 0 H1"/><path d="M0 0 H1"/>'), { createId });
    expect(shapes.map((shape) => shape.id)).toEqual([
      "00000000-0000-4000-8000-000000000000",
      "00000000-0000-4000-8000-000000000001",
    ]);
    expect(importSvg(svg('<path d="M0 0 H1"/>')).shapes[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["isn't XML", "not xml at all"],
    ["isn't SVG", "<html><body/></html>"],
  ])("rejects a file that %s", (_, text) => {
    expect(() => importSvg(text)).toThrow(SvgImportError);
  });

  it("rejects a DPI that isn't positive", () => {
    expect(() => importSvg(svg(""), { dpi: 0 })).toThrow(RangeError);
  });
});

describe("importSvg on editor exports", () => {
  function expectValid(shapes: Shape[]) {
    for (const shape of shapes) expect(Shape.safeParse(shape).error).toBeUndefined();
  }

  it("imports an Inkscape drawing in millimetres, with layers", () => {
    const { shapes, warnings } = importSvg(inkscape, { fileName: "inkscape.svg" });
    expectValid(shapes);
    expect(shapes.map(({ name, layer }) => ({ name, layer }))).toEqual([
      { name: "rect1", layer: "Outline" },
      { name: "Hole A", layer: "Holes" },
      { name: "path3", layer: "Holes" },
    ]);
    const [rect, hole, square] = shapes as [Shape, Shape, Shape];
    expectBounds(rect.paths, [10, 10], [190, 90], 9);
    expect(hole.paths[0]?.segments).toEqual([
      { kind: "arc", to: [54, 50], center: [50, 50], clockwise: true },
    ]);
    expectBounds(square.paths, [160, 45], [180, 65], 9);
    expect(warnings).toEqual(["Skipped text (convert it to paths before exporting) (1)."]);
  });

  it("imports an Illustrator drawing in points at 72 DPI", () => {
    const { shapes, warnings } = importSvg(illustrator, { dpi: 72 });
    expectValid(shapes);
    expect(warnings).toEqual([]);
    expect(shapes.map((shape) => shape.layer)).toEqual(["Cut", "Cut", "Cut", "Cut"]);
    const [rect, circle, triangle, arch] = shapes as [Shape, Shape, Shape, Shape];
    // 283.46 pt = 100 mm; 0.01 pt of rounding in the file is 0.004 mm.
    expectBounds(rect.paths, [5, 5], [95, 45], 2);
    const [arc] = circle.paths[0]?.segments ?? [];
    if (arc?.kind !== "arc") throw new Error("Expected an arc");
    expect(arc.clockwise).toBe(true);
    expect(arc.center[0]).toBeCloseTo(25, 2);
    expect(arc.center[1]).toBeCloseTo(25, 2);
    expect(Math.hypot(arc.to[0] - arc.center[0], arc.to[1] - arc.center[1])).toBeCloseTo(5, 2);
    expectBounds(triangle.paths, [50, 15], [80, 35], 2);
    expect(triangle.paths[0]?.closed).toBe(true);
    expect(arch.paths[0]?.segments.map((s) => s.kind)).toEqual(["cubic", "cubic"]);
    expectBounds(arch.paths, [75, 30], [85, 35], 2);
  });

  it("imports a legacy Illustrator file with its layers, skipping its private data", () => {
    const { shapes, warnings } = importSvg(illustratorLegacy, { dpi: 72 });
    expectValid(shapes);
    expect(warnings).toEqual([]);
    expect(shapes.map(({ name, layer }) => ({ name, layer }))).toEqual([
      { name: "", layer: "Outline" },
      { name: "", layer: "Holes" },
    ]);
    // 144 × 72 px at 72 DPI is 50.8 × 25.4 mm.
    expectBounds(shapes[0]?.paths ?? [], [12.7, 6.35], [38.1, 19.05], 9);
    expect(shapes[1]?.paths[0]?.segments[0]).toEqual({
      kind: "arc",
      to: [28.575, 12.7],
      center: [25.4, 12.7],
      clockwise: true,
    });
  });

  it("imports an Affinity drawing with nested group transforms", () => {
    const { shapes, warnings } = importSvg(affinity);
    expectValid(shapes);
    expect(warnings).toEqual([]);
    expect(shapes.map(({ name, layer }) => ({ name, layer }))).toEqual([
      { name: "Outline", layer: "Layer 1" },
      { name: "", layer: "Layer 1" },
      { name: "Slot", layer: "Layer 1" },
    ]);
    const [outline, circle, slot] = shapes as [Shape, Shape, Shape];
    // 377.953 × 188.976 px at 96 DPI is 100 × 50 mm; 18.898 px is 5 mm.
    expectBounds(outline.paths, [5, 5], [95, 45], 2);
    const [arc] = circle.paths[0]?.segments ?? [];
    if (arc?.kind !== "arc") throw new Error("Expected an arc");
    expect(arc.center[0]).toBeCloseTo(36.17, 2);
    expect(arc.center[1]).toBeCloseTo(24.42, 2);
    expect(Math.hypot(arc.to[0] - arc.center[0], arc.to[1] - arc.center[1])).toBeCloseTo(5, 3);
    expectBounds(slot.paths, [60, 20], [80, 30], 2);
  });

  it("keeps curves for flattening at any tolerance", () => {
    const { shapes } = importSvg(inkscape);
    const hole = shapes[1]?.paths[0] as Path;
    expect(flattenPath(hole, 0.001).length).toBeGreaterThan(flattenPath(hole, 0.1).length);
  });
});

describe("svgNeedsDpi", () => {
  it.each([
    ["sizes in real units with a viewBox", 'width="10cm" height="5in" viewBox="0 0 1 1"', false],
    ["one size in real units with a viewBox", 'width="100mm" viewBox="0 0 1 1"', false],
    ["sizes in pixels", 'width="100px" height="50px" viewBox="0 0 1 1"', true],
    ["unitless sizes", 'width="100" height="50" viewBox="0 0 1 1"', true],
    ["relative sizes", 'width="100%" height="100%" viewBox="0 0 1 1"', true],
    ["a viewBox alone", 'viewBox="0 0 1 1"', true],
    ["real units without a viewBox", 'width="100mm" height="50mm"', true],
    ["no size at all", "", true],
  ])("says whether %s need a DPI", (_, root, needed) => {
    expect(svgNeedsDpi(svg("", root))).toBe(needed);
  });

  it("goes by the file's units, not the editor that wrote it", () => {
    expect(svgNeedsDpi(inkscape)).toBe(false);
    expect(svgNeedsDpi(illustrator)).toBe(true);
    expect(svgNeedsDpi(illustratorLegacy)).toBe(true);
    expect(svgNeedsDpi(affinity)).toBe(true);
  });

  it("rejects files that aren't SVG", () => {
    expect(() => svgNeedsDpi("<html/>")).toThrow(SvgImportError);
  });

  it("only takes CSS units, not other names", () => {
    expect(svgNeedsDpi(svg("", 'width="10constructor" height="5toString" viewBox="0 0 1 1"'))).toBe(
      true,
    );
  });
});
