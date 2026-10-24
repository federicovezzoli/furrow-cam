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
 * single-stroke loop. "H" then "O" kern by -100.
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

describe("parseFont", () => {
  it("reads OTF and WOFF bytes, taking the cap height from the font", () => {
    const otf = testFont().toArrayBuffer();
    const fromOtf = textPaths(parseFont(otf), settings("HO"));
    expect(bounds(fromOtf).max[1]).toBeCloseTo(10, 6);
    expect(textPaths(parseFont(woff(otf)), settings("HO"))).toEqual(fromOtf);
    expect(textPaths(parseFont(new Uint8Array(otf)), settings("HO"))).toEqual(fromOtf);
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

  it("draws nothing for characters the font lacks, and nothing for blank text", () => {
    expect(textPaths(outline, settings("HЖ"))).toHaveLength(1);
    expect(textPaths(outline, settings("   "))).toEqual([]);
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
