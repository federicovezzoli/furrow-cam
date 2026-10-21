import {
  MessageError,
  type Path,
  type Point,
  pointsCoincide,
  type Segment,
  type Shape,
} from "@furrow/document";
import { union } from "../../geometry/clipper";
import { flattenPath } from "../../geometry/flatten";
import { MM_PER_INCH } from "../../units/units";
import { defaultCreateId, isFinitePath, toStock } from "../common";
import { type ImportMessage, type ImportMessageCode, SkipCounter } from "../messages";
import { NUMBER_PATTERN, parseNumbers } from "./number";
import { arcToCubics, parsePathData, type RawSegment, type RawSubpath } from "./path-data";
import { Stylesheet } from "./style";
import {
  determinant,
  IDENTITY,
  isSimilarity,
  type Matrix,
  multiply,
  parseTransform,
  translation,
} from "./transform";
import { parseXml, type XmlElement, XmlError } from "./xml";

/** Pixels per inch that `px` and unitless lengths are read at unless told otherwise: the CSS value. */
export const DEFAULT_SVG_DPI = 96;

/**
 * Most elements drawn, counting every copy a `use` makes, so a file whose
 * references fan out can't freeze the import.
 */
export const MAX_SVG_ELEMENTS = 200_000;

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
  warnings: ImportMessage[];
};

/** A parsed SVG file, so it can be checked with `svgNeedsDpi` and imported without parsing it twice. */
export type SvgDocument = { readonly root: XmlElement };

/** The file isn't an SVG document at all; anything less is a warning instead. */
export class SvgImportError extends MessageError<ImportMessage> {}

/** What is wrong with a file that isn't XML, and where. */
function xmlMessage({ position, problem }: XmlError): ImportMessage {
  if (problem === undefined) return { code: "svg.invalidXml", values: { position } };
  if ("unclosed" in problem) {
    return { code: "svg.unclosedElement", values: { element: problem.unclosed, position } };
  }
  if ("closing" in problem) {
    return { code: "svg.unexpectedClosingTag", values: { element: problem.closing, position } };
  }
  return { code: "svg.invalidAttribute", values: { attribute: problem.attribute, position } };
}

/** Elements whose children are drawn. `symbol` is only drawn through `use`. */
const CONTAINERS = new Set(["g", "a", "svg", "switch"]);

/** Content that can't become geometry, with what is said when it is skipped. */
const UNSUPPORTED: Record<string, ImportMessageCode> = {
  text: "svg.skip.text",
  image: "svg.skip.images",
  foreignObject: "svg.skip.foreignObject",
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

const LENGTH = new RegExp(String.raw`^\s*(${NUMBER_PATTERN})\s*([a-zA-Z]*)\s*$`);

const INVALID_POSITION = "svg.skip.invalidPosition";

type Context = {
  /** From this element's user units to millimetres, from the file's origin. */
  matrix: Matrix;
  layer: string;
  /** Name of the closest named group, for shapes with no name of their own (Affinity names groups). */
  name: string;
  /** Whether groups here are layers: children of the root, or of wrappers around them. */
  topLevel: boolean;
  /** The inherited `visibility`: hidden shapes aren't imported, though a child can be shown again. */
  visible: boolean;
};

/** Parses an SVG file. Throws `SvgImportError` if it isn't one. */
export function parseSvg(text: string): SvgDocument {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (error) {
    if (error instanceof XmlError) throw new SvgImportError(xmlMessage(error));
    throw error;
  }
  if (localName(root) !== "svg") throw new SvgImportError({ code: "svg.notSvg" });
  return { root };
}

/**
 * Whether importing the file depends on the DPI: its size is given in
 * pixels, or not at all. Then only the user can tell, since every editor can
 * write files at any DPI.
 */
export function svgNeedsDpi(svg: SvgDocument | string): boolean {
  const { root } = typeof svg === "string" ? parseSvg(svg) : svg;
  const width = parseLength(root.attributes.width);
  const height = parseLength(root.attributes.height);
  const isPixels = (length: ParsedLength | null) => length?.unit === "" || length?.unit === "px";
  const isAbsolute = (length: ParsedLength | null) => length !== null && !isPixels(length);
  // With a viewBox and a size in real units, the viewBox is scaled to fit and pixels never matter.
  return (
    parseViewBox(root.attributes.viewBox) === null ||
    isPixels(width) ||
    isPixels(height) ||
    !(isAbsolute(width) || isAbsolute(height))
  );
}

/**
 * Imports an SVG document as shapes, one per drawn element, one path per
 * subpath, in millimetres with Y up. Only their positions relative to each
 * other matter: the workspace aligns the drawing to the stock by its bounding
 * box (ADR-0022). Curves are kept: circles as arcs (unless a transform makes
 * them ellipses), elliptical arcs and quadratics as cubics (ADR-0007).
 * Fills, strokes and clipping are ignored, and so are hidden elements.
 */
export function importSvg(
  svg: SvgDocument | string,
  options: SvgImportOptions = {},
): SvgImportResult {
  const { root } = typeof svg === "string" ? parseSvg(svg) : svg;
  const dpi = options.dpi ?? DEFAULT_SVG_DPI;
  if (!(dpi > 0)) throw new RangeError("DPI must be positive");
  const createId = options.createId ?? defaultCreateId;

  const ids = new Map<string, XmlElement>();
  collectIds(root, ids);
  const styles = new Stylesheet(root);

  const skipped = new SkipCounter();
  const skip = (code: ImportMessageCode) => skipped.add(code);
  const shapes: Shape[] = [];
  const page = pageTransform(root, dpi);
  /** Elements being drawn, from the root down through `use` references, to catch cycles. */
  const drawing = new Set<XmlElement>();
  let drawn = 0;

  /** Draws `element`'s children, with `element` marked as being drawn. */
  function within(element: XmlElement, drawInside: () => void) {
    drawing.add(element);
    drawInside();
    drawing.delete(element);
  }

  function drawChildren(element: XmlElement, context: Context) {
    within(element, () => {
      for (const child of element.children) draw(child, context);
    });
  }

  /** `sizedBy` is the `use` drawing an `svg`, whose `width` and `height` size its viewport. */
  function draw(element: XmlElement, parent: Context, name = label(element), sizedBy?: XmlElement) {
    if (drawn >= MAX_SVG_ELEMENTS) return;
    drawn++;
    if (styles.value(element, "display") === "none") return;
    const visibility = styles.value(element, "visibility");
    const visible =
      visibility === "visible" || visibility === "hidden" || visibility === "collapse"
        ? visibility === "visible"
        : parent.visible;
    if (drawing.has(element)) {
      // SVG draws nothing for a reference to an element that contains it.
      skip("svg.skip.circular");
      return;
    }
    const tag = localName(element);
    let matrix = parent.matrix;
    const transform = element.attributes.transform;
    if (transform !== undefined) {
      const parsed = parseTransform(transform);
      if (parsed) matrix = multiply(matrix, parsed);
      else skip("svg.skip.invalidTransform");
    }

    if (CONTAINERS.has(tag)) {
      // Legacy Illustrator files wrap their layers in a `switch` and a group of its own.
      const wrapper = tag === "switch" || element.attributes["i:extraneous"] === "self";
      const isLayer =
        !wrapper &&
        (element.attributes["inkscape:groupmode"] === "layer" || (parent.topLevel && tag === "g"));
      if (tag === "svg") {
        const position = offset(element);
        if (!position) {
          skip(INVALID_POSITION);
          return;
        }
        const viewport = viewportTransform(element, sizedBy ? [sizedBy, element] : [element]);
        if (typeof viewport === "string") skip(viewport);
        if (viewport === null || typeof viewport === "string") return;
        matrix = multiply(multiply(matrix, position), viewport);
      }
      const context: Context = {
        matrix,
        layer: isLayer ? label(element) : parent.layer,
        name: isLayer ? "" : wrapper ? parent.name : label(element) || parent.name,
        topLevel: wrapper && parent.topLevel,
        visible,
      };
      if (tag === "switch") {
        // Only the first child the renderer supports is drawn; Illustrator puts its private data first.
        const first = element.children.find(
          (child) =>
            localName(child) !== "foreignObject" &&
            child.attributes.requiredExtensions === undefined,
        );
        if (first) within(element, () => draw(first, context));
      } else {
        drawChildren(element, context);
      }
      return;
    }

    if (tag === "use") {
      const href = element.attributes.href ?? element.attributes["xlink:href"];
      const target = href?.startsWith("#") ? ids.get(href.slice(1)) : undefined;
      if (!target) {
        skip("svg.skip.missingReferences");
        return;
      }
      const position = offset(element);
      if (!position) {
        skip(INVALID_POSITION);
        return;
      }
      const context: Context = {
        matrix: multiply(matrix, position),
        layer: parent.layer,
        name: name || label(target) || parent.name,
        topLevel: false,
        visible,
      };
      const targetTag = localName(target);
      within(element, () => {
        if (targetTag !== "symbol") {
          draw(target, context, name || label(target), targetTag === "svg" ? element : undefined);
          return;
        }
        if (drawing.has(target)) {
          skip("svg.skip.circular");
          return;
        }
        // The `use` sizes the symbol's viewport.
        const viewport = viewportTransform(target, [element, target]);
        if (typeof viewport === "string") skip(viewport);
        if (viewport === null || typeof viewport === "string") return;
        drawChildren(target, { ...context, matrix: multiply(context.matrix, viewport) });
      });
      return;
    }

    const advice = UNSUPPORTED[tag];
    if (advice) {
      skip(advice);
      return;
    }

    if (!visible) return;
    const subpaths = shapeSubpaths(element, tag, matrix);
    if (subpaths === undefined) return; // Not drawable, e.g. defs, metadata or a gradient.
    if (subpaths === null) {
      skip("svg.skip.invalidSizes");
      return;
    }
    const paths = subpaths.flatMap((subpath) => {
      if ("arc" in subpath) return [subpath.arc];
      const path = toPath(subpath, matrix);
      return path ? [path] : [];
    });
    if (!paths.every(isFinitePath)) {
      skip("svg.skip.tooLarge");
      return;
    }
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

  drawChildren(root, { matrix: page, layer: "", name: "", topLevel: true, visible: true });

  const warnings = skipped.messages();
  if (styles.unresolvedHiding) warnings.push({ code: "svg.stylesheetHides" });
  if (drawn >= MAX_SVG_ELEMENTS) {
    warnings.push({ code: "svg.tooManyElements", values: { max: MAX_SVG_ELEMENTS } });
  }
  return { shapes, warnings };
}

/** The translation by an element's `x` and `y`, or `null` if they are invalid or relative. */
function offset(element: XmlElement): Matrix | null {
  const x = length(element, "x");
  const y = length(element, "y");
  return Number.isFinite(x) && Number.isFinite(y) ? translation(x, y) : null;
}

/**
 * The transform into a nested viewport (`svg`, or `symbol` drawn by `use`)
 * from its `viewBox`, sized by the first of `sizedBy` that gives a size:
 * `null` if it draws nothing, or what to warn about when it can't be placed.
 */
function viewportTransform(
  element: XmlElement,
  sizedBy: XmlElement[],
): Matrix | null | ImportMessageCode {
  const viewBox = parseViewBox(element.attributes.viewBox);
  if (!viewBox) return IDENTITY;
  const size = (name: string) => {
    for (const source of sizedBy) {
      const value = optionalLength(source, name);
      if (value !== undefined) return value;
    }
    // The default is 100% of the viewport around it, which isn't tracked.
    return Number.NaN;
  };
  const width = size("width");
  const height = size("height");
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return "svg.skip.nestedViewports";
  }
  if (width <= 0 || height <= 0) return null;
  return viewBoxTransform(viewBox, width, height, element.attributes.preserveAspectRatio);
}

type ViewBox = { x: number; y: number; width: number; height: number };

function parseViewBox(text: string | undefined): ViewBox | null {
  const numbers = parseNumbers(text ?? "");
  const [x = 0, y = 0, width = 0, height = 0] = numbers;
  if (numbers.length !== 4 || !(width > 0 && height > 0)) return null;
  return { x, y, width, height };
}

/** Maps `viewBox` onto a `width` × `height` viewport as `preserveAspectRatio` says (y down). */
function viewBoxTransform(
  viewBox: ViewBox,
  width: number,
  height: number,
  preserveAspectRatio: string | undefined,
): Matrix {
  let sx = width / viewBox.width;
  let sy = height / viewBox.height;
  let alignX = 0;
  let alignY = 0;
  const [align = "xMidYMid", meetOrSlice = "meet"] = (preserveAspectRatio ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "defer" && word !== "");
  if (align !== "none") {
    const scale = meetOrSlice === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = scale;
    sy = scale;
    const fraction = (position: string) => (position === "Min" ? 0 : position === "Max" ? 1 : 0.5);
    alignX = (width - viewBox.width * scale) * fraction(align.slice(1, 4));
    alignY = (height - viewBox.height * scale) * fraction(align.slice(5, 8));
  }
  return [sx, 0, 0, sy, alignX - sx * viewBox.x, alignY - sy * viewBox.y];
}

/**
 * The transform from the root's user units to millimetres from the page's
 * bottom-left corner, flipping SVG's downward y. Without a page size, y is
 * flipped about the root's origin.
 */
function pageTransform(root: XmlElement, dpi: number): Matrix {
  const mmPerPx = MM_PER_INCH / dpi;
  let width = pageLength(root.attributes.width, mmPerPx);
  let height = pageLength(root.attributes.height, mmPerPx);
  const viewBox = parseViewBox(root.attributes.viewBox);

  if (!viewBox) {
    // No viewBox: user units are pixels.
    return [mmPerPx, 0, 0, -mmPerPx, 0, height ?? 0];
  }
  if (width === null && height === null) {
    width = viewBox.width * mmPerPx;
    height = viewBox.height * mmPerPx;
  } else if (width === null) {
    width = ((height as number) * viewBox.width) / viewBox.height;
  } else if (height === null) {
    height = (width * viewBox.height) / viewBox.width;
  }
  const pageHeight = height as number;
  const flip: Matrix = [1, 0, 0, -1, 0, pageHeight];
  return multiply(
    flip,
    viewBoxTransform(viewBox, width, pageHeight, root.attributes.preserveAspectRatio),
  );
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
    case "path":
      // Like SVG, draw what was read before an error.
      return parsePathData(element.attributes.d ?? "").subpaths;
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
      return [rectSubpath(x, y, width, height, rx, ry)];
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
      return [ellipseSubpath(cx, cy, rx, ry)];
    }
    case "line": {
      const [x1, y1, x2, y2] = [n("x1"), n("y1"), n("x2"), n("y2")];
      if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
      return [{ start: [x1, y1], segments: [{ kind: "line", to: [x2, y2] }], closed: false }];
    }
    case "polyline":
    case "polygon": {
      const numbers = parseNumbers(element.attributes.points ?? "");
      if (numbers.length < 2) return [];
      // An odd number of coordinates drops the last one, as in SVG.
      const segments: RawSegment[] = [];
      for (let i = 2; i + 1 < numbers.length; i += 2) {
        segments.push({ kind: "line", to: [numbers[i] as number, numbers[i + 1] as number] });
      }
      const start: Point = [numbers[0] as number, numbers[1] as number];
      return [{ start, segments, closed: tag === "polygon" }];
    }
    default:
      return undefined;
  }
}

/**
 * A rect with corners rounded by `rx` × `ry` (both zero for square ones),
 * drawn as SVG does from the top edge; `toPath` drops sides rounded away.
 */
function rectSubpath(
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
  ry: number,
): RawSubpath {
  const rounded = rx > 0 && ry > 0;
  const start: Point = rounded ? [x + rx, y] : [x, y];
  const segments: RawSegment[] = [];
  let current = start;
  const lineTo = (to: Point) => {
    segments.push({ kind: "line", to });
    current = to;
  };
  const cornerTo = (to: Point) => {
    if (rounded) segments.push(...arcToCubics(current, rx, ry, 0, false, true, to));
    current = to;
  };
  if (rounded) {
    lineTo([x + width - rx, y]);
    cornerTo([x + width, y + ry]);
    lineTo([x + width, y + height - ry]);
    cornerTo([x + width - rx, y + height]);
    lineTo([x + rx, y + height]);
    cornerTo([x, y + height - ry]);
    lineTo([x, y + ry]);
    cornerTo(start);
  } else {
    lineTo([x + width, y]);
    lineTo([x + width, y + height]);
    lineTo([x, y + height]);
  }
  return { start, segments, closed: true };
}

/** An ellipse as four quarter arcs from its rightmost point, in the direction SVG draws it. */
function ellipseSubpath(cx: number, cy: number, rx: number, ry: number): RawSubpath {
  const quarters: Point[] = [
    [cx + rx, cy],
    [cx, cy + ry],
    [cx - rx, cy],
    [cx, cy - ry],
    [cx + rx, cy],
  ];
  const segments: RawSegment[] = [];
  for (let i = 1; i < quarters.length; i++) {
    const from = quarters[i - 1] as Point;
    segments.push(...arcToCubics(from, rx, ry, 0, false, true, quarters[i] as Point));
  }
  return { start: quarters[0] as Point, segments, closed: true };
}

/**
 * A subpath in millimetres, without the zero-length segments the
 * document rejects; `null` if nothing is left of it. It is closed if it ends
 * with `Z`, or where it started (see `pointsCoincide`) around an area:
 * editors often end a closed outline back on its start without a `Z`.
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
  if (segments.length === 1 && segments[0]?.kind === "line") {
    return { start, segments, closed: false };
  }
  if (subpath.closed) return { start, segments, closed: true };
  const path: Path = { start, segments, closed: false };
  // Ending on its start closes it only if that encloses an area: a path that
  // goes there and back would be a ring the kernel drops without a word.
  const encloses =
    pointsCoincide(current, start) && union([flattenPath({ ...path, closed: true })]).length > 0;
  return { ...path, closed: encloses };
}

type ParsedLength = { value: number; unit: string };

/** A length in a CSS unit we know (lower case, `""` if unitless), or `null` if invalid or relative. */
function parseLength(text: string | undefined): ParsedLength | null {
  const match = text?.match(LENGTH);
  if (!match) return null;
  const unit = (match[2] as string).toLowerCase();
  return Object.hasOwn(CSS_PX_PER_UNIT, unit) ? { value: Number(match[1]), unit } : null;
}

/** A root `width` or `height` in millimetres, or `null` if missing, relative or invalid. */
function pageLength(text: string | undefined, mmPerPx: number): number | null {
  const length = parseLength(text);
  if (!length) return null;
  const mmPerUnit =
    length.unit === "" || length.unit === "px"
      ? mmPerPx
      : (CSS_PX_PER_UNIT[length.unit] as number) * (MM_PER_INCH / 96);
  const result = length.value * mmPerUnit;
  return result > 0 && Number.isFinite(result) ? result : null;
}

/** An attribute's length in user units: 0 if missing, `NaN` if invalid or relative. */
function length(element: XmlElement, name: string): number {
  return optionalLength(element, name) ?? 0;
}

function optionalLength(element: XmlElement, name: string): number | undefined {
  const text = element.attributes[name];
  if (text === undefined || text.trim() === "auto") return undefined;
  const length = parseLength(text);
  return length ? length.value * (CSS_PX_PER_UNIT[length.unit] as number) : Number.NaN;
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
