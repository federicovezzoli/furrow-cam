import {
  type Path,
  type Point,
  pointsCoincide,
  type Segment,
  segmentIssue,
  type TextSettings,
} from "@furrow/document";
import { intersection, type Polygon, signedArea, union } from "../geometry/clipper";
import { flattenPath } from "../geometry/flatten";
import { roundCoordinate } from "../geometry/round";
import { mapPath } from "../geometry/translate";
import { type Font, type GlyphCommand, layoutLine } from "./font";

/** Overlaps smaller than this, in mm², are where glyphs only touch. */
const OVERLAP_AREA = 1e-6;

/**
 * Text item `settings`' outlines in stock coordinates (PRD-0010 T2,
 * ADR-0059): one line laid out in `font` with its kerning, at the cap
 * height and alignment, then placed. Quadratics become cubics, as on SVG
 * import. Glyphs that overlap, as in script fonts, are merged into one
 * outline, flattened, so a pocket doesn't cut the overlap twice. A
 * single-stroke font gives open paths that an engraving follows once. Empty
 * if no character has an outline.
 */
export function textPaths(font: Font, settings: TextSettings): Path[] {
  const { glyphs, width } = layoutLine(font, settings.text, settings.height);
  const shift = settings.align === "left" ? 0 : settings.align === "center" ? -width / 2 : -width;
  const outlines = glyphs.map((commands) => glyphPaths(commands, font.singleStroke, shift));
  const paths = font.singleStroke ? outlines.flat() : mergeOverlaps(outlines);
  const { position, rotation, mirrored } = settings.placement;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const place = ([x, y]: Point): Point => {
    const flipped = mirrored ? -x : x;
    return [
      roundCoordinate(position[0] + flipped * cos - y * sin),
      roundCoordinate(position[1] + flipped * sin + y * cos),
    ];
  };
  return paths.flatMap((path) => cleanPath(mapPath(path, place, mirrored)) ?? []);
}

/**
 * A glyph's contours as paths, moved `shift` along the line. Outline fonts'
 * contours are closed; a single-stroke font's are open unless they end where
 * they start.
 */
function glyphPaths(commands: GlyphCommand[], singleStroke: boolean, shift: number): Path[] {
  const at = ([x, y]: Point): Point => [x + shift, y];
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
  // A quadratic is the cubic whose controls are 2/3 of the way to its control point.
  const [qx, qy] = at(command.control);
  const third = ([x, y]: Point): Point => [x + ((qx - x) * 2) / 3, y + ((qy - y) * 2) / 3];
  return { kind: "cubic", c1: third(current), c2: third(to), to };
}

/**
 * The glyphs' paths, with every group of glyphs whose outlines overlap
 * merged into one outline (its union, flattened). Glyphs that only touch, or
 * stand alone, keep their curves.
 */
function mergeOverlaps(glyphs: Path[][]): Path[] {
  const polygons = glyphs.map((paths) => union(paths.map((path) => flattenPath(path))));
  const boxes = polygons.map(box);
  const group = glyphs.map((_, i) => i);
  const root = (i: number): number => {
    while (group[i] !== i) i = group[i] as number;
    return i;
  };
  for (let i = 0; i < glyphs.length; i++) {
    for (let j = i + 1; j < glyphs.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (!a || !b || a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) continue;
      const overlap = intersection(polygons[i] ?? [], polygons[j] ?? []);
      const area = overlap.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon)), 0);
      if (area > OVERLAP_AREA) group[root(j)] = root(i);
    }
  }
  const members = new Map<number, number[]>();
  for (let i = 0; i < glyphs.length; i++) {
    members.set(root(i), [...(members.get(root(i)) ?? []), i]);
  }
  return [...members.values()].flatMap((indices) => {
    if (indices.length === 1) return glyphs[indices[0] as number] ?? [];
    return union(indices.flatMap((i) => polygons[i] ?? [])).map(polygonPath);
  });
}

/** The bounding box of `polygons` as `[minX, minY, maxX, maxY]`, or `null` for none. */
function box(polygons: Polygon[]): [number, number, number, number] | null {
  const points = polygons.flat();
  if (points.length === 0) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
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
