import { type Path, type Point, pointsCoincide, type Segment, type Shape } from "@furrow/document";
import { flattenPath } from "../flatten";
import { MM_PER_INCH } from "../units";
import { parsePathData, type RawSubpath } from "./path-data";
import {
  apply,
  determinant,
  isSimilarity,
  type Matrix,
  multiply,
  parseNumbers,
  parseTransform,
  translation,
} from "./transform";
import { parseXml, type XmlElement, XmlError } from "./xml";

/** Pixels per inch that `px` and unitless lengths are read at unless told otherwise: the CSS value. */
export const DEFAULT_SVG_DPI = 96;

export type SvgImportOptions = {
  /**
   * Pixels per inch for `px` and unitless lengths (default `DEFAULT_SVG_DPI`).
   * Ask the user when `svgNeedsDpi` says the file depends on it.
   */
  dpi?: number;
  /** Stored as each shape's `source`. */
  fileName?: string;
  /** Id of each new shape (default `crypto.randomUUID`). */
  createId?: () => string;
};

export type SvgImportResult = {
  shapes: Shape[];
  /** What was skipped or assumed, for the user; empty when the file imported as drawn. */
  warnings: string[];
};

/** The file isn't an SVG document at all; anything less is a warning instead. */
export class SvgImportError extends Error {}

/** Elements whose children are drawn. `symbol` is only drawn through `use`. */
const CONTAINERS = new Set(["g", "a", "svg", "switch"]);

/** Content that can't become geometry, with the advice shown when it is skipped. */
const UNSUPPORTED: Record<string, string> = {
  text: "text (convert it to paths before exporting)",
  image: "images",
  foreignObject: "embedded non-SVG content",
};

/** Lengths in CSS units inside the drawing, in user units (CSS pixels at 96 per inch). */
const CSS_PX_PER_UNIT: Record<string, number> = {
  "": 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
};

const LENGTH = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$/;

/** How deep `use` references may nest, against reference cycles. */
const MAX_USE_DEPTH = 32;

type Context = {
  /** From this element's user units to millimetres in stock coordinates. */
  matrix: Matrix;
  layer: string;
  /** Name of the closest named group, for shapes with no name of their own (Affinity names groups). */
  name: string;
  /** Whether this element is a direct child of the root `svg`. */
  topLevel: boolean;
  useDepth: number;
};

/**
 * Imports an SVG document as shapes in stock coordinates (ADR-0014): one
 * shape per drawn element, one path per subpath. The page is placed with its
 * bottom-left corner on the stock's, its size taken from `width`/`height`
 * and `viewBox`. Curves are kept: circles as arcs (unless a transform makes
 * them ellipses), elliptical arcs and quadratics as cubics (ADR-0007).
 * Fills, strokes and clipping are ignored, and so are hidden elements.
 */
export function importSvg(text: string, options: SvgImportOptions = {}): SvgImportResult {
  const root = parseSvg(text);
  const dpi = options.dpi ?? DEFAULT_SVG_DPI;
  if (!(dpi > 0)) throw new RangeError("DPI must be positive");
  const createId = options.createId ?? defaultCreateId;

  const ids = new Map<string, XmlElement>();
  collectIds(root, ids);

  const skipped = new Map<string, number>();
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1);
  const shapes: Shape[] = [];
  const page = pageTransform(root, dpi);

  function drawChildren(element: XmlElement, context: Context) {
    for (const child of element.children) draw(child, context);
  }

  function draw(element: XmlElement, parent: Context, name = label(element)) {
    if (isHidden(element)) return;
    const tag = localName(element);
    let matrix = parent.matrix;
    const transform = element.attributes.transform;
    if (transform !== undefined) {
      const parsed = parseTransform(transform);
      if (parsed) matrix = multiply(matrix, parsed);
      else skip("elements with an invalid transform (drawn untransformed)");
    }

    if (CONTAINERS.has(tag)) {
      const isLayer =
        element.attributes["inkscape:groupmode"] === "layer" || (parent.topLevel && tag === "g");
      if (tag === "svg") {
        // A nested viewport: only its position is applied.
        matrix = multiply(matrix, translation(length(element, "x"), length(element, "y")));
      }
      const context: Context = {
        matrix,
        layer: isLayer ? label(element) : parent.layer,
        name: isLayer ? "" : label(element) || parent.name,
        topLevel: false,
        useDepth: parent.useDepth,
      };
      if (tag === "switch") {
        // Only the first child the renderer supports is drawn; Illustrator puts its private data first.
        const first = element.children.find(
          (child) =>
            localName(child) !== "foreignObject" &&
            child.attributes.requiredExtensions === undefined,
        );
        if (first) draw(first, context);
      } else {
        drawChildren(element, context);
      }
      return;
    }

    if (tag === "use") {
      const href = element.attributes.href ?? element.attributes["xlink:href"];
      const target = href?.startsWith("#") ? ids.get(href.slice(1)) : undefined;
      if (!target || parent.useDepth >= MAX_USE_DEPTH) {
        skip("references to missing or circular elements");
        return;
      }
      const context: Context = {
        matrix: multiply(matrix, translation(length(element, "x"), length(element, "y"))),
        layer: parent.layer,
        name: name || label(target) || parent.name,
        topLevel: false,
        useDepth: parent.useDepth + 1,
      };
      if (localName(target) === "symbol") drawChildren(target, context);
      else draw(target, context, name || label(target));
      return;
    }

    const advice = UNSUPPORTED[tag];
    if (advice) {
      skip(advice);
      return;
    }

    const subpaths = shapeSubpaths(element, tag, matrix);
    if (subpaths === undefined) return; // Not drawable, e.g. defs, metadata or a gradient.
    if (subpaths === null) {
      skip("shapes with invalid or relative (%) sizes or data");
      return;
    }
    const paths = subpaths.flatMap((subpath) => {
      if ("arc" in subpath) return [subpath.arc];
      const path = toPath(subpath, matrix);
      return path ? [path] : [];
    });
    if (paths.length > 0) {
      shapes.push({
        id: createId(),
        name: name || parent.name,
        layer: parent.layer,
        ...(options.fileName !== undefined && { source: options.fileName }),
        paths,
      });
    }
  }

  drawChildren(root, { matrix: page.matrix, layer: "", name: "", topLevel: true, useDepth: 0 });

  const warnings = Array.from(skipped, ([what, count]) => `Skipped ${what} (${count}).`);
  if (page.height === null && shapes.length > 0) {
    // No page to place: rest the drawing on the stock's bottom edge.
    const bottom = Math.min(
      ...shapes.flatMap((shape) =>
        shape.paths.flatMap((path) => flattenPath(path).map((p) => p[1])),
      ),
    );
    for (const shape of shapes)
      shape.paths = shape.paths.map((path) => translatePath(path, -bottom));
    warnings.push(
      "The file has no page size, so the drawing was placed on the stock's bottom edge.",
    );
  }
  return { shapes, warnings };
}

/**
 * Whether importing `text` depends on the DPI: its size is given in pixels,
 * or not at all. Then only the user can tell, since every editor can write
 * files at any DPI. Throws `SvgImportError` like `importSvg`.
 */
export function svgNeedsDpi(text: string): boolean {
  const root = parseSvg(text);
  const { width, height } = root.attributes;
  const viewBox = parseNumbers(root.attributes.viewBox ?? "");
  const hasViewBox =
    viewBox.length === 4 && (viewBox[2] as number) > 0 && (viewBox[3] as number) > 0;
  const unit = (value: string | undefined) => value?.match(LENGTH)?.[2]?.toLowerCase();
  const isPixels = (value: string | undefined) => ["", "px"].includes(unit(value) ?? "none");
  const isAbsolute = (value: string | undefined) => (unit(value) ?? "") in ABSOLUTE_UNITS;
  // With a viewBox and a size in real units, the viewBox is scaled to fit and pixels never matter.
  return (
    !hasViewBox || isPixels(width) || isPixels(height) || !(isAbsolute(width) || isAbsolute(height))
  );
}

const ABSOLUTE_UNITS = { mm: true, cm: true, in: true, q: true, pt: true, pc: true };

function parseSvg(text: string): XmlElement {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (error) {
    if (error instanceof XmlError) {
      throw new SvgImportError(`This file isn't valid XML: ${error.message}`);
    }
    throw error;
  }
  if (localName(root) !== "svg") throw new SvgImportError("This file isn't an SVG drawing.");
  return root;
}

type CircleSubpath = { arc: Path };

/**
 * The element's subpaths in user units, a full circle as a ready path,
 * `undefined` if the element is never drawn and `null` if it is invalid.
 */
function shapeSubpaths(
  element: XmlElement,
  tag: string,
  matrix: Matrix,
): (RawSubpath | CircleSubpath)[] | null | undefined {
  const n = (name: string) => length(element, name);
  switch (tag) {
    case "path": {
      const { subpaths } = parsePathData(element.attributes.d ?? "");
      // Like SVG, draw what was read before an error.
      return subpaths;
    }
    case "rect": {
      const [x, y, width, height] = [n("x"), n("y"), n("width"), n("height")];
      if (![x, y, width, height].every(Number.isFinite)) return null;
      if (width <= 0 || height <= 0) return [];
      let rx = optionalLength(element, "rx");
      let ry = optionalLength(element, "ry");
      if (Number.isNaN(rx) || Number.isNaN(ry)) return null;
      rx ??= ry ?? 0;
      ry ??= rx;
      rx = Math.min(Math.max(rx, 0), width / 2);
      ry = Math.min(Math.max(ry, 0), height / 2);
      if (rx === 0 || ry === 0) return pathData(`M${x},${y}H${x + width}V${y + height}H${x}Z`);
      const arc = `A${rx},${ry},0,0,1`;
      return pathData(
        `M${x + rx},${y}H${x + width - rx}${arc},${x + width},${y + ry}` +
          `V${y + height - ry}${arc},${x + width - rx},${y + height}` +
          `H${x + rx}${arc},${x},${y + height - ry}V${y + ry}${arc},${x + rx},${y}Z`,
      );
    }
    case "circle":
    case "ellipse": {
      const [cx, cy] = [n("cx"), n("cy")];
      const rx = tag === "circle" ? n("r") : n("rx");
      const ry = tag === "circle" ? rx : n("ry");
      if (![cx, cy, rx, ry].every(Number.isFinite)) return null;
      if (rx <= 0 || ry <= 0) return [];
      if (rx === ry && isSimilarity(matrix)) {
        const center = toStock(matrix, [cx, cy]);
        const start = toStock(matrix, [cx + rx, cy]);
        if (pointsCoincide(center, start)) return [];
        // SVG draws circles towards positive angles; a mirroring transform reverses that.
        const clockwise = determinant(matrix) < 0;
        return [
          {
            arc: {
              start,
              segments: [{ kind: "arc", to: start, center, clockwise }],
              closed: true,
            },
          },
        ];
      }
      const arc = `A${rx},${ry},0,0,1`;
      return pathData(
        `M${cx + rx},${cy}${arc},${cx},${cy + ry}${arc},${cx - rx},${cy}` +
          `${arc},${cx},${cy - ry}${arc},${cx + rx},${cy}Z`,
      );
    }
    case "line": {
      const coordinates = [n("x1"), n("y1"), n("x2"), n("y2")];
      if (!coordinates.every(Number.isFinite)) return null;
      const [x1, y1, x2, y2] = coordinates;
      return pathData(`M${x1},${y1}L${x2},${y2}`);
    }
    case "polyline":
    case "polygon": {
      const numbers = parseNumbers(element.attributes.points ?? "");
      const points: string[] = [];
      // An odd number of coordinates drops the last one, as in SVG.
      for (let i = 0; i + 1 < numbers.length; i += 2)
        points.push(`${numbers[i]},${numbers[i + 1]}`);
      if (points.length === 0) return [];
      return pathData(`M${points.join("L")}${tag === "polygon" ? "Z" : ""}`);
    }
    default:
      return undefined;
  }
}

function pathData(d: string): RawSubpath[] {
  return parsePathData(d).subpaths;
}

/**
 * A subpath in stock coordinates, without the zero-length segments the
 * document rejects; `null` if nothing is left of it.
 */
function toPath(subpath: RawSubpath, matrix: Matrix): Path | null {
  const start = toStock(matrix, subpath.start);
  const segments: Segment[] = [];
  let current = start;
  for (const segment of subpath.segments) {
    const to = toStock(matrix, segment.to);
    if (segment.kind === "line") {
      if (pointsCoincide(current, to)) continue;
      segments.push({ kind: "line", to });
    } else {
      const c1 = toStock(matrix, segment.c1);
      const c2 = toStock(matrix, segment.c2);
      if ([c1, c2, to].every((p) => pointsCoincide(current, p))) continue;
      segments.push({ kind: "cubic", c1, c2, to });
    }
    current = to;
  }
  if (segments.length === 0) return null;
  // A closed single line would just retrace itself.
  const closed = subpath.closed && !(segments.length === 1 && segments[0]?.kind === "line");
  return { start, segments, closed };
}

/** Imported coordinates are rounded to a nanometre, dropping float noise from transforms. */
function round(value: number): number {
  // Adding 0 turns -0 into 0.
  return Math.round(value * 1e9) / 1e9 + 0;
}

function toStock(matrix: Matrix, point: Point): Point {
  const [x, y] = apply(matrix, point);
  return [round(x), round(y)];
}

function translatePath(path: Path, dy: number): Path {
  const move = ([x, y]: Point): Point => [x, round(y + dy)];
  return {
    start: move(path.start),
    segments: path.segments.map((segment): Segment => {
      if (segment.kind === "line") return { kind: "line", to: move(segment.to) };
      if (segment.kind === "arc") {
        return { ...segment, to: move(segment.to), center: move(segment.center) };
      }
      return { kind: "cubic", c1: move(segment.c1), c2: move(segment.c2), to: move(segment.to) };
    }),
    closed: path.closed,
  };
}

/**
 * The transform from the root's user units to millimetres in stock
 * coordinates, flipping SVG's downward y. `height` is the page height in
 * millimetres, or `null` when the file gives no page size.
 */
function pageTransform(root: XmlElement, dpi: number): { matrix: Matrix; height: number | null } {
  const mmPerPx = MM_PER_INCH / dpi;
  let width = pageLength(root.attributes.width, mmPerPx);
  let height = pageLength(root.attributes.height, mmPerPx);
  const viewBox = parseNumbers(root.attributes.viewBox ?? "");
  const [vx = 0, vy = 0, vw = 0, vh = 0] = viewBox;

  if (viewBox.length !== 4 || !(vw > 0 && vh > 0)) {
    // No viewBox: user units are pixels.
    return {
      matrix: [mmPerPx, 0, 0, -mmPerPx, 0, height ?? 0],
      height,
    };
  }

  if (width === null && height === null) {
    width = vw * mmPerPx;
    height = vh * mmPerPx;
  } else if (width === null) {
    width = ((height as number) * vw) / vh;
  } else if (height === null) {
    height = (width * vh) / vw;
  }
  const pageHeight = height as number;

  let sx = width / vw;
  let sy = pageHeight / vh;
  let alignX = 0;
  let alignY = 0;
  const [align = "xMidYMid", meetOrSlice = "meet"] = (root.attributes.preserveAspectRatio ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "defer" && word !== "");
  if (align !== "none") {
    const scale = meetOrSlice === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = scale;
    sy = scale;
    const fraction = (position: string) => (position === "Min" ? 0 : position === "Max" ? 1 : 0.5);
    alignX = (width - vw * scale) * fraction(align.slice(1, 4));
    alignY = (pageHeight - vh * scale) * fraction(align.slice(5, 8));
  }
  return {
    matrix: [sx, 0, 0, -sy, alignX - sx * vx, pageHeight - alignY + sy * vy],
    height: pageHeight,
  };
}

/** A root `width` or `height` in millimetres, or `null` if missing, relative or invalid. */
function pageLength(value: string | undefined, mmPerPx: number): number | null {
  const match = value?.match(LENGTH);
  if (!match) return null;
  const number = Number(match[1]);
  const unit = (match[2] as string).toLowerCase();
  const mmPerUnit =
    unit === "" || unit === "px"
      ? mmPerPx
      : (CSS_PX_PER_UNIT[unit] ?? Number.NaN) * (MM_PER_INCH / 96);
  const result = number * mmPerUnit;
  return result > 0 ? result : null;
}

/** An attribute's length in user units: 0 if missing, `NaN` if invalid or relative. */
function length(element: XmlElement, name: string): number {
  return optionalLength(element, name) ?? 0;
}

function optionalLength(element: XmlElement, name: string): number | undefined {
  const value = element.attributes[name];
  if (value === undefined || value.trim() === "auto") return undefined;
  const match = value.match(LENGTH);
  if (!match) return Number.NaN;
  return Number(match[1]) * (CSS_PX_PER_UNIT[(match[2] as string).toLowerCase()] ?? Number.NaN);
}

function isHidden(element: XmlElement): boolean {
  if (element.attributes.display?.trim() === "none") return true;
  return /(?:^|;)\s*display\s*:\s*none\s*(?:;|$|!)/.test(element.attributes.style ?? "");
}

/** The element's name without an `svg:` prefix; other namespaces keep theirs and are never drawn. */
function localName(element: XmlElement): string {
  return element.name.startsWith("svg:") ? element.name.slice(4) : element.name;
}

/** The name the editor gave an element or layer: Inkscape, Affinity, Illustrator, then its id. */
function label(element: XmlElement): string {
  const { attributes } = element;
  return (
    attributes["inkscape:label"] ??
    attributes["serif:id"] ??
    attributes["data-name"] ??
    attributes.id ??
    ""
  );
}

function collectIds(element: XmlElement, ids: Map<string, XmlElement>) {
  const id = element.attributes.id;
  if (id !== undefined && !ids.has(id)) ids.set(id, element);
  for (const child of element.children) collectIds(child, ids);
}

function defaultCreateId(): string {
  // Workers and Node both have Web Crypto; the package's lib types don't include it.
  return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
}
