import type { Point } from "@furrow/document";
import { type Glyph, type Font as OpentypeFont, parse, type RenderOptions } from "opentype.js";

/**
 * A parsed TTF, OTF or WOFF font (ADR-0061). A `singleStroke` font draws
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
 * Kerning on; no ligatures (ADR-0061), no hinting, and no colour layers or
 * SVG glyphs, which need a DOM. Cast: `@types/opentype.js` describes 1.3,
 * without 2.0's options.
 */
const RENDER = {
  kerning: true,
  features: { liga: false, rlig: false },
  hinting: false,
  drawLayers: false,
  drawSVG: false,
} as RenderOptions;

/** Parses `bytes` (TTF, OTF or WOFF; not WOFF2). Throws if they aren't a font it can read. */
export function parseFont(bytes: ArrayBuffer | Uint8Array, singleStroke = false): Font {
  // A copy: a view's buffer, or a Node `Buffer`'s, may hold other bytes around the font.
  return {
    font: parse(bytes instanceof Uint8Array ? Uint8Array.from(bytes).buffer : bytes),
    singleStroke,
  };
}

/**
 * The name `font` gives, to tell fonts apart: its family, then its style
 * unless that is "Regular" (e.g. "Arvo", "Arvo Bold"), in English if it has
 * one, else the first it has; empty if none.
 */
export function fontName({ font }: Font): string {
  // `@types/opentype.js` describes 1.3's flat names; 2.0 keeps a table per platform.
  const names = font.names as unknown as Record<
    string,
    Record<string, Record<string, string>> | undefined
  >;
  const read = (key: string) => {
    for (const table of ["windows", "macintosh", "unicode"]) {
      const entry = names[table]?.[key];
      const name = entry?.en ?? Object.values(entry ?? {})[0];
      if (name) return name;
    }
    return "";
  };
  const style = read("fontSubfamily");
  return [read("fontFamily"), style === "Regular" ? "" : style].filter(Boolean).join(" ");
}

/**
 * The font's cap height in font units: from its OS/2 table, else the top of
 * its "H", else its ascender, else its em.
 */
function capHeight(font: OpentypeFont): number {
  const stored = font.tables.os2?.sCapHeight;
  if (typeof stored === "number" && stored > 0) return stored;
  const top = font.hasChar("H") ? font.charToGlyph("H").getBoundingBox().y2 : 0;
  if (top > 0) return top;
  return font.ascender > 0 ? font.ascender : font.unitsPerEm;
}

/** The font size, in millimetres per em, that gives `font` a cap height of `height` millimetres. */
export function emSize({ font }: Font, height: number): number {
  return (height * font.unitsPerEm) / capHeight(font);
}

/**
 * Lays one `line` out with the font's kerning, at `size` millimetres per em
 * (`emSize`), `letterSpacing` millimetres added between characters: each
 * glyph's outline commands, its origin on the baseline at the line's start,
 * and the line's advance width. Characters the font lacks take their space
 * but draw nothing, rather than its missing-glyph box.
 */
export function layoutLine(
  { font, singleStroke }: Font,
  line: string,
  size: number,
  letterSpacing = 0,
): { glyphs: GlyphCommand[][]; width: number } {
  const missing = font.glyphs.get(0);
  const glyphs: GlyphCommand[][] = [];
  /**
   * The spacings before this glyph: one before each glyph that advances but
   * the first, so none after the last, and a zero-width accent stays on its
   * letter.
   */
  let spacings = -1;
  const advance = font.forEachGlyph(line, 0, 0, size, RENDER, (glyph, gx, y, fontSize) => {
    if (glyph.advanceWidth) spacings++;
    const x = gx + Math.max(spacings, 0) * letterSpacing;
    if (glyph === missing) return;
    if (singleStroke && font.outlinesFormat === "truetype") {
      glyphs.push(strokeCommands(glyph, x, fontSize / font.unitsPerEm));
      return;
    }
    // opentype.js draws y down, as on a screen.
    const point = (px: number, py: number): Point => [px, -py];
    const commands = glyph.getPath(x, y, fontSize, RENDER, font).commands;
    const mapped = commands.map((command): GlyphCommand => {
      if (command.type === "Z") return command;
      const to = point(command.x, command.y);
      if (command.type === "Q") return { type: "Q", control: point(command.x1, command.y1), to };
      if (command.type === "C") {
        const c1 = point(command.x1, command.y1);
        return { type: "C", c1, c2: point(command.x2, command.y2), to };
      }
      return { type: command.type, to };
    });
    glyphs.push(mapped);
  });
  return { glyphs, width: advance + Math.max(spacings, 0) * letterSpacing };
}

/** A TrueType point as opentype.js reads it; `@types/opentype.js` lists only `lastPointOfContour`. */
type GlyphPoint = { x: number; y: number; onCurve: boolean };

/**
 * A single-stroke TrueType glyph's strokes, read from its points, `x` along
 * the line, `scale` millimetres per font unit (ADR-0061). TrueType closes
 * every contour, and opentype.js draws the closing segment, but a
 * single-stroke font's contours are open strokes: nothing joins a stroke's
 * last point back to its first, whether either end is a curve's or a line's.
 */
function strokeCommands(glyph: Glyph, x: number, scale: number): GlyphCommand[] {
  // opentype.js reads a glyph's points when its path is first built.
  if (glyph.path.commands.length === 0) return [];
  const at = (point: GlyphPoint): Point => [x + point.x * scale, point.y * scale];
  return glyph.getContours().flatMap((contour) => {
    const [first, ...rest] = contour as unknown as GlyphPoint[];
    if (!first) return [];
    const commands: GlyphCommand[] = [{ type: "M", to: at(first) }];
    let control: GlyphPoint | null = null;
    for (const point of rest) {
      if (point.onCurve) {
        commands.push(
          control
            ? { type: "Q", control: at(control), to: at(point) }
            : { type: "L", to: at(point) },
        );
        control = null;
        continue;
      }
      // Between two control points lies an implied point on the curve, halfway.
      if (control) {
        const half = { x: (control.x + point.x) / 2, y: (control.y + point.y) / 2, onCurve: true };
        commands.push({ type: "Q", control: at(control), to: at(half) });
      }
      control = point;
    }
    // A stroke whose last point is a control point ends on it.
    if (control) commands.push({ type: "L", to: at(control) });
    return commands;
  });
}
