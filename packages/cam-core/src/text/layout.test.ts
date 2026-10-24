import type { Path, Point, TextSettings } from "@furrow/document";
import { Glyph, Font as OpentypeFont, Path as OpentypePath } from "opentype.js";
import { describe, expect, it } from "vitest";
import { pathBounds } from "../geometry/bounds";
import { signedArea } from "../geometry/clipper";
import { flattenPath } from "../geometry/flatten";
import { mirrorPoint, rotatePoint } from "../geometry/scale";
import { mapPath } from "../geometry/translate";
import { type Font, parseFont } from "./font";
import { textPaths } from "./layout";

/** A drawing of a glyph in font units, y up. */
type Draw = (path: OpentypePath) => void;

function rect(x0: number, y0: number, x1: number, y1: number): Draw {
  return (path) => {
    path.moveTo(x0, y0);
    path.lineTo(x1, y0);
    path.lineTo(x1, y1);
    path.lineTo(x0, y1);
    path.close();
  };
}

function glyph(name: string, char: string | null, advanceWidth: number, ...draws: Draw[]) {
  const path = new OpentypePath();
  for (const draw of draws) draw(path);
  const unicode = char === null ? undefined : char.codePointAt(0);
  return new Glyph({ name, unicode, advanceWidth, path });
}

/**
 * A 1000-unit font: "H" is 600 × 700 (its cap height), "O" a ring with a
 * quadratic, "a" a 600 × 300 box that overlaps the next glyph by 100, "l"
 * and "v" single strokes, open and closed by the font, and "o" a closed
 * single-stroke loop. "H" then "O" kern by -100. "X" overlaps itself, and
 * "f" then "i" has a ligature.
 */
function testFont(): OpentypeFont {
  const font = new OpentypeFont({
    familyName: "Test",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      glyph(".notdef", null, 500, rect(0, 0, 500, 700)),
      glyph("space", " ", 300),
      glyph("H", "H", 700, rect(0, 0, 600, 700)),
      glyph("O", "O", 700, (path) => {
        path.moveTo(0, 0);
        path.lineTo(600, 0);
        path.quadTo(700, 350, 600, 700);
        path.lineTo(0, 700);
        path.close();
        rect(100, 600, 500, 100)(path);
      }),
      glyph("a", "a", 500, rect(0, 0, 600, 300)),
      glyph("l", "l", 200, (path) => {
        path.moveTo(100, 0);
        path.lineTo(100, 700);
      }),
      glyph("v", "v", 500, (path) => {
        path.moveTo(0, 700);
        path.lineTo(250, 0);
        path.lineTo(500, 700);
        path.close();
      }),
      // Two bars drawn the same way round, crossing within the glyph.
      glyph("X", "X", 700, rect(0, 300, 600, 400), rect(250, 0, 350, 700)),
      glyph("f", "f", 400, rect(0, 0, 300, 700)),
      glyph("i", "i", 300, rect(0, 0, 200, 500)),
      glyph("f_i", null, 700, rect(0, 0, 600, 700)),
      glyph("o", "o", 500, (path) => {
        path.moveTo(0, 0);
        path.lineTo(400, 0);
        path.lineTo(400, 400);
        path.lineTo(0, 0);
        path.close();
      }),
    ],
  });
  // Parsing numbers the glyphs; a font made in memory leaves them all 0.
  for (let i = 0; i < font.glyphs.length; i++) font.glyphs.get(i).index = i;
  // `@types/opentype.js` describes 1.3, without `addLigature`.
  const substitution = font.substitution as unknown as {
    addLigature(feature: string, ligature: { sub: number[]; by: number }, script: string): void;
  };
  const f = font.charToGlyphIndex("f");
  substitution.addLigature("liga", { sub: [f, font.charToGlyphIndex("i")], by: f + 2 }, "latn");
  font.kerningPairs = { [`${font.charToGlyphIndex("H")},${font.charToGlyphIndex("O")}`]: -100 };
  return font;
}

const outline: Font = { font: testFont(), singleStroke: false };
const strokes: Font = { font: testFont(), singleStroke: true };

/** 10 mm cap height: 1 font unit is 1/70 mm. */
const UNIT = 10 / 700;

function settings(text: string, fields: Partial<TextSettings> = {}): TextSettings {
  return {
    text,
    font: "test",
    height: 10,
    align: "left",
    placement: { position: [0, 0], rotation: 0, mirrored: false },
    ...fields,
  };
}

function bounds(paths: Path[]) {
  const boxes = paths.map(pathBounds);
  return {
    min: [Math.min(...boxes.map((b) => b.min[0])), Math.min(...boxes.map((b) => b.min[1]))],
    max: [Math.max(...boxes.map((b) => b.max[0])), Math.max(...boxes.map((b) => b.max[1]))],
  };
}

const area = (path: Path) => Math.abs(signedArea(flattenPath(path)));

/** `font`'s bytes wrapped, uncompressed, in a WOFF container. */
function woff(sfnt: ArrayBuffer): Uint8Array {
  const view = new DataView(sfnt);
  const count = view.getUint16(4);
  const tables = Array.from({ length: count }, (_, i) => {
    const at = 12 + i * 16;
    return {
      tag: view.getUint32(at),
      checksum: view.getUint32(at + 4),
      data: new Uint8Array(sfnt, view.getUint32(at + 8), view.getUint32(at + 12)),
    };
  });
  const padded = (n: number) => (n + 3) & ~3;
  let offset = 44 + count * 20;
  const out = new Uint8Array(offset + tables.reduce((sum, t) => sum + padded(t.data.length), 0));
  const header = new DataView(out.buffer);
  header.setUint32(0, 0x774f4646); // "wOFF"
  header.setUint32(4, view.getUint32(0));
  header.setUint32(8, out.length);
  header.setUint16(12, count);
  header.setUint32(16, sfnt.byteLength);
  tables.forEach(({ tag, checksum, data }, i) => {
    const at = 44 + i * 20;
    header.setUint32(at, tag);
    header.setUint32(at + 4, offset);
    header.setUint32(at + 8, data.length);
    header.setUint32(at + 12, data.length);
    header.setUint32(at + 16, checksum);
    out.set(data, offset);
    offset += padded(data.length);
  });
  return out;
}

/** A TrueType point: on the curve, or a quadratic's control point. */
type TruePoint = { x: number; y: number; onCurve: boolean; lastPointOfContour?: boolean };

/**
 * A single-stroke TrueType font of open strokes, each glyph given by its
 * contours' points as a TrueType file stores them: "l" a straight stroke,
 * "c" one whose end is a control point, "s" one whose start is.
 */
function trueTypeStrokes(): Font {
  const contour = (...points: [number, number, boolean][]) =>
    points.map(([x, y, onCurve], i) => ({
      x,
      y,
      onCurve,
      lastPointOfContour: i === points.length - 1,
    }));
  const strokes: [string, TruePoint[]][] = [
    ["l", contour([100, 0, true], [100, 700, true])],
    ["c", contour([400, 0, true], [0, 0, false], [0, 700, false], [400, 700, false])],
    ["s", contour([0, 0, false], [400, 0, true], [400, 700, true])],
  ];
  const font = new OpentypeFont({
    familyName: "Strokes",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      glyph(".notdef", null, 500),
      // The outline opentype.js draws doesn't matter: the points do.
      ...strokes.map(([c]) => glyph(c, c, 500, rect(0, 0, 400, 700))),
    ],
  });
  for (let i = 0; i < font.glyphs.length; i++) font.glyphs.get(i).index = i;
  for (const [c, points] of strokes) Object.assign(font.charToGlyph(c), { points });
  Object.assign(font, { outlinesFormat: "truetype" });
  return { font, singleStroke: true };
}

describe("parseFont", () => {
  it("reads OTF and WOFF bytes, taking the cap height from the font", () => {
    const otf = testFont().toArrayBuffer();
    const fromOtf = textPaths(parseFont(otf), settings("HO"));
    expect(bounds(fromOtf).max[1]).toBeCloseTo(10, 6);
    expect(textPaths(parseFont(woff(otf)), settings("HO"))).toEqual(fromOtf);
    expect(textPaths(parseFont(new Uint8Array(otf)), settings("HO"))).toEqual(fromOtf);
  });

  it("reads a font that is a view into larger memory, as Node's Buffer gives", () => {
    const otf = new Uint8Array(testFont().toArrayBuffer());
    /** Like a Node `Buffer`, whose `slice` is a view, not a copy. */
    class View extends Uint8Array {
      override slice(start?: number, end?: number) {
        return this.subarray(start, end);
      }
    }
    const pool = new Uint8Array(otf.length + 32);
    pool.set(otf, 16);
    const view = new View(pool.buffer, 16, otf.length);
    expect(textPaths(parseFont(view), settings("HO"))).toEqual(
      textPaths(parseFont(otf), settings("HO")),
    );
  });

  it("throws on bytes that aren't a font", () => {
    expect(() => parseFont(new Uint8Array(64))).toThrow();
  });
});

describe("textPaths", () => {
  it("lays a line out at the cap height, its origin on the baseline at its start", () => {
    const paths = textPaths(outline, settings("H"));
    expect(paths).toHaveLength(1);
    expect(paths[0]?.closed).toBe(true);
    const { min, max } = bounds(paths);
    expect(min).toEqual([0, 0]);
    expect(max[0]).toBeCloseTo(600 * UNIT, 9);
    expect(max[1]).toBeCloseTo(10, 9);
  });

  it("aligns the line's advance width on its origin", () => {
    const left = bounds(textPaths(outline, settings("H H")));
    const center = bounds(textPaths(outline, settings("H H", { align: "center" })));
    const right = bounds(textPaths(outline, settings("H H", { align: "right" })));
    expect(left.min[0]).toBe(0);
    expect(center.min[0]).toBeCloseTo(-850 * UNIT, 9);
    expect(right.min[0]).toBeCloseTo(-1700 * UNIT, 9);
    expect(right.max[0]).toBeCloseTo(-100 * UNIT, 9);
  });

  it("kerns glyph pairs", () => {
    const [, ring] = textPaths(outline, settings("HO"));
    expect(ring && pathBounds(ring).min[0]).toBeCloseTo(600 * UNIT, 9);
  });

  it("keeps quadratics as cubics, and a glyph's holes", () => {
    const paths = textPaths(outline, settings("O"));
    expect(paths).toHaveLength(2);
    expect(paths[0]?.segments.map((segment) => segment.kind)).toEqual(["line", "cubic", "line"]);
  });

  it("places the line: mirrored, then turned about its origin, then moved", () => {
    const placement = { position: [50, 20] as Point, rotation: 90, mirrored: true };
    const placed = textPaths(outline, settings("HO", { placement }));
    const move = (point: Point) => {
      const [x, y] = rotatePoint(mirrorPoint(point, "x", [0, 0]), 90, [0, 0]);
      return [x + 50, y + 20] as Point;
    };
    const expected = textPaths(outline, settings("HO")).map((path) => mapPath(path, move, true));
    placed.forEach((path, i) => {
      const flat = flattenPath(path).flat();
      const other = flattenPath(expected[i] as Path).flat();
      flat.forEach((value, k) => {
        expect(value).toBeCloseTo(other[k] as number, 6);
      });
    });
  });

  it("merges overlapping glyphs into one outline, and leaves apart ones alone", () => {
    const merged = textPaths(outline, settings("aa"));
    expect(merged).toHaveLength(1);
    // Clipper rounds to 0.1 µm.
    expect(area(merged[0] as Path)).toBeCloseTo(1100 * 300 * UNIT ** 2, 3);
    expect(textPaths(outline, settings("a a"))).toHaveLength(2);
  });

  it("merges a glyph's own overlapping contours", () => {
    const [cross, ...rest] = textPaths(outline, settings("X"));
    expect(rest).toEqual([]);
    // Clipper rounds to 0.1 µm.
    expect(area(cross as Path)).toBeCloseTo((600 * 100 + 100 * 600) * UNIT ** 2, 3);
  });

  it("sets no ligatures, so each character keeps its glyph", () => {
    expect(textPaths(outline, settings("fi"))).toHaveLength(2);
  });

  it("lays a line break out as a space, until several lines", () => {
    expect(textPaths(outline, settings("H\nH"))).toEqual(textPaths(outline, settings("H H")));
  });

  it("falls back to the ascender for the cap height of a font without an H", () => {
    const font = new OpentypeFont({
      familyName: "Test",
      styleName: "Regular",
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      glyphs: [
        glyph(".notdef", null, 500, rect(0, 0, 500, 700)),
        glyph("a", "a", 500, rect(0, 0, 600, 300)),
      ],
    });
    const top = bounds(textPaths({ font, singleStroke: false }, settings("a"))).max[1];
    expect(top).toBeCloseTo(300 * (10 / 800), 9);
  });

  it("draws nothing for characters the font lacks, and nothing for blank text", () => {
    expect(textPaths(outline, settings("HЖ"))).toHaveLength(1);
    expect(textPaths(outline, settings("   "))).toEqual([]);
  });

  it("reads a single-stroke TrueType font's strokes from its points, with no closing segment", () => {
    const font = trueTypeStrokes();
    // No "H": the ascender sets the cap height.
    const unit = 10 / 800;
    const [l, ...more] = textPaths(font, settings("l"));
    expect(more).toEqual([]);
    expect(l).toEqual({
      start: [100 * unit, 0],
      segments: [{ kind: "line", to: [100 * unit, 700 * unit] }],
      closed: false,
    });
    // Ends on a control point: the curve, then a line to it, and nothing back to the start.
    const [c] = textPaths(font, settings("c"));
    expect(c?.closed).toBe(false);
    expect(c?.segments.map((segment) => segment.kind)).toEqual(["cubic", "cubic", "line"]);
    expect(c?.segments.at(-1)?.to[0]).toBeCloseTo(400 * unit, 9);
    expect(c?.segments.at(-1)?.to[1]).toBeCloseTo(700 * unit, 9);
    // Starts on a control point: it starts there.
    const [s] = textPaths(font, settings("s"));
    expect(s?.start).toEqual([0, 0]);
    expect(s?.closed).toBe(false);
    expect(s?.segments.at(-1)?.to[1]).toBeCloseTo(700 * unit, 9);
  });

  it("gives a single-stroke font's strokes as open paths, unless they end where they start", () => {
    const [line, vee, loop] = textPaths(strokes, settings("lvo"));
    expect(line).toMatchObject({ closed: false, segments: [{ kind: "line" }] });
    expect(vee).toMatchObject({ closed: false });
    expect(vee?.segments).toHaveLength(2);
    expect(loop?.closed).toBe(true);
    // Strokes are never merged, though they overlap.
    expect(textPaths(strokes, settings("ll", { text: "ll" }))).toHaveLength(2);
  });
});
