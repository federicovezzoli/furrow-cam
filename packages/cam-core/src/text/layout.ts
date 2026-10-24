import {
  type Path,
  type Point,
  pointsCoincide,
  type Segment,
  segmentIssue,
  type TextSettings,
} from "@furrow/document";
import { pathBounds, type Rect } from "../geometry/bounds";
import { type FillRule, intersection, type Polygon, signedArea, union } from "../geometry/clipper";
import { quadraticToCubic } from "../geometry/curve";
import { flattenPath } from "../geometry/flatten";
import { textFrame } from "../geometry/scale";
import { mapPath } from "../geometry/translate";
import { emSize, type Font, type GlyphCommand, layoutLine } from "./font";

/** Overlaps smaller than this, in mm², are where glyphs only touch. */
const OVERLAP_AREA = 1e-6;

/**
 * Text item `settings`' outlines in stock coordinates (PRD-0010 T2, T5, T6,
 * ADR-0059): each line laid out in `font` with its kerning, at the cap
 * height, `letterSpacing` times the height between characters, aligned on its
 * own, `lineSpacing` times the height below the one before; then placed. Quadratics become cubics, as on
 * SVG import. Glyphs that overlap, as in script fonts, or whose own contours
 * do, are merged into one outline, flattened, so a pocket doesn't cut the
 * overlap twice. A single-stroke font gives open paths that an engraving
 * follows once. Empty if no character has an outline.
 */
export function textPaths(font: Font, settings: TextSettings): Path[] {
  const { height, align, lineSpacing, letterSpacing } = settings;
  const size = emSize(font, height);
  const outlines = settings.text.split(/\r\n|\n|\r/).flatMap((line, i) => {
    const { glyphs, width } = layoutLine(font, line, size, letterSpacing * height);
    const dx = align === "left" ? 0 : align === "center" ? -width / 2 : -width;
    const dy = -i * lineSpacing * height;
    return glyphs.map((commands) => glyphPaths(commands, font.singleStroke, [dx, dy]));
  });
  const paths = font.singleStroke ? outlines.flat() : mergeOverlaps(outlines);
  const place = textFrame(settings.placement);
  return paths.flatMap(
    (path) => cleanPath(mapPath(path, place, settings.placement.mirrored)) ?? [],
  );
}

/**
 * A glyph's contours as paths, moved by `shift` to its line's place. Outline
 * fonts' contours are closed; a single-stroke font's are open unless they end
 * where they start.
 */
function glyphPaths(commands: GlyphCommand[], singleStroke: boolean, [dx, dy]: Point): Path[] {
  const at = ([x, y]: Point): Point => [x + dx, y + dy];
  const paths: Path[] = [];
  let path: Path | null = null;
  let current: Point = [0, 0];
  const end = () => {
    if (path) path.closed = !singleStroke || pointsCoincide(current, path.start);
    path = null;
  };
  for (const command of commands) {
    if (command.type === "Z") {
      end();
      continue;
    }
    const to = at(command.to);
    if (command.type === "M") {
      end();
      path = { start: to, segments: [], closed: false };
      paths.push(path);
    } else if (path) {
      path.segments.push(segment(command, current, to, at));
    }
    current = to;
  }
  end();
  return paths;
}

/** A cubic for a quadratic or cubic command from `current` to `to`, else a line. */
function segment(
  command: GlyphCommand,
  current: Point,
  to: Point,
  at: (point: Point) => Point,
): Segment {
  if (command.type === "C") return { kind: "cubic", c1: at(command.c1), c2: at(command.c2), to };
  if (command.type !== "Q") return { kind: "line", to };
  return quadraticToCubic(current, at(command.control), to);
}

/**
 * The glyphs' paths, with every group of glyphs whose outlines overlap
 * merged into one outline (its union, flattened), and every glyph whose own
 * contours overlap, as composite accented letters' may. Other glyphs keep
 * their curves.
 */
function mergeOverlaps(all: Path[][]): Path[] {
  // A space has no contours.
  const glyphs = all.filter((paths) => paths.length > 0);
  const polygons = glyphs.map((paths) => paths.map((path) => flattenPath(path)));
  const filled = polygons.map((rings) => union(rings));
  const boxes = glyphs.map((paths) => paths.map(pathBounds).reduce(joinRects));
  const group = glyphs.map((_, i) => i);
  const root = (i: number): number => {
    while (group[i] !== i) {
      group[i] = group[group[i] as number] as number;
      i = group[i] as number;
    }
    return i;
  };
  for (let i = 0; i < glyphs.length; i++) {
    for (let j = i + 1; j < glyphs.length; j++) {
      const [a, b] = [boxes[i] as Rect, boxes[j] as Rect];
      if (a.max[0] <= b.min[0] || b.max[0] <= a.min[0]) continue;
      if (a.max[1] <= b.min[1] || b.max[1] <= a.min[1]) continue;
      const overlap = intersection(filled[i] ?? [], filled[j] ?? []);
      if (overlap.reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0) > OVERLAP_AREA) {
        group[root(j)] = root(i);
      }
    }
  }
  const members = new Map<number, number[]>();
  for (let i = 0; i < glyphs.length; i++) {
    const r = root(i);
    const list = members.get(r);
    if (list) list.push(i);
    else members.set(r, [i]);
  }
  return [...members.values()].flatMap((indices) => {
    const [only] = indices as [number];
    const rings = polygons[only] ?? [];
    // Contours that overlap fill more with the non-zero rule than with even-odd.
    if (indices.length === 1 && area(rings, "nonZero") - area(rings, "evenOdd") <= OVERLAP_AREA) {
      return glyphs[only] ?? [];
    }
    return union(indices.flatMap((i) => polygons[i] ?? [])).map(polygonPath);
  });
}

/** The area `rings` fill under `fillRule`, in mm². */
function area(rings: Polygon[], fillRule: FillRule): number {
  return Math.abs(union(rings, fillRule).reduce((sum, ring) => sum + signedArea(ring), 0));
}

function joinRects(a: Rect, b: Rect): Rect {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
  };
}

/** A closed path of straight lines around `polygon`. */
function polygonPath([start, ...rest]: Polygon): Path {
  const segments = rest.map((to): Segment => ({ kind: "line", to }));
  return { start: start ?? [0, 0], segments, closed: true };
}

/**
 * `path` without the segments that rounding or the font left with no
 * length, or `null` if nothing is left to cut: a lone point would read as a
 * drill position, and a closed single line as nothing.
 */
function cleanPath(path: Path): Path | null {
  const segments: Segment[] = [];
  let current = path.start;
  for (const segment of path.segments) {
    if (segmentIssue(current, segment) !== null) continue;
    segments.push(segment);
    current = segment.to;
  }
  const [only] = segments;
  if (!only || (path.closed && segments.length === 1 && only.kind === "line")) return null;
  return { ...path, segments };
}
