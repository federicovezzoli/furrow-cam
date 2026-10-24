import type { Point } from "@furrow/document";
import { type Font as OpentypeFont, parse, type RenderOptions } from "opentype.js";

/**
 * A parsed TTF, OTF or WOFF font (ADR-0060). A `singleStroke` font draws
 * each stroke once, so its contours are open paths an engraving follows,
 * not outlines to cut around.
 */
export type Font = { readonly font: OpentypeFont; readonly singleStroke: boolean };

/** One command of a glyph's outline, in millimetres, y up. */
export type GlyphCommand =
  | { type: "M" | "L"; to: Point }
  | { type: "Q"; control: Point; to: Point }
  | { type: "C"; c1: Point; c2: Point; to: Point }
  | { type: "Z" };

/**
 * Kerning on; no hinting, and no colour layers or SVG glyphs, which need a
 * DOM. Cast: `@types/opentype.js` describes 1.3, without 2.0's options.
 */
const RENDER = {
  kerning: true,
  hinting: false,
  drawLayers: false,
  drawSVG: false,
} as RenderOptions;

/** Parses `bytes` (TTF, OTF or WOFF; not WOFF2). Throws if they aren't a font it can read. */
export function parseFont(bytes: ArrayBuffer | Uint8Array, singleStroke = false): Font {
  return { font: parse(bytes instanceof Uint8Array ? bytes.slice().buffer : bytes), singleStroke };
}

/** The font's cap height in font units: from its OS/2 table, else the top of its "H". */
function capHeight(font: OpentypeFont): number {
  const stored = font.tables.os2?.sCapHeight;
  if (typeof stored === "number" && stored > 0) return stored;
  const top = font.charToGlyph("H").getBoundingBox().y2;
  return top > 0 ? top : font.ascender;
}

/**
 * Lays `text` out on one line with the font's kerning, at a cap height of
 * `height` millimetres: each glyph's outline commands, its origin on the
 * baseline at the line's start, and the line's advance width. Characters the
 * font lacks take their space but draw nothing, rather than its
 * missing-glyph box.
 */
export function layoutLine(
  { font }: Font,
  text: string,
  height: number,
): { glyphs: GlyphCommand[][]; width: number } {
  const size = (height * font.unitsPerEm) / capHeight(font);
  const missing = font.glyphs.get(0);
  const glyphs: GlyphCommand[][] = [];
  const width = font.forEachGlyph(text, 0, 0, size, RENDER, (glyph, x, y, fontSize) => {
    if (glyph === missing) return;
    // opentype.js draws y down, as on a screen.
    const point = (px: number, py: number): Point => [px, -py];
    const commands = glyph.getPath(x, y, fontSize, RENDER, font).commands;
    glyphs.push(
      commands.map((command): GlyphCommand => {
        if (command.type === "Z") return command;
        const to = point(command.x, command.y);
        if (command.type === "Q") return { type: "Q", control: point(command.x1, command.y1), to };
        if (command.type === "C") {
          const c1 = point(command.x1, command.y1);
          return { type: "C", c1, c2: point(command.x2, command.y2), to };
        }
        return { type: command.type, to };
      }),
    );
  });
  return { glyphs, width };
}
