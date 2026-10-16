import {
  distance,
  GEOMETRY_TOLERANCE,
  type Path,
  type Point,
  pointsCoincide,
  type Segment,
  type Shape,
  type Units,
} from "@furrow/document";
import { MM_PER_INCH } from "../../units/units";
import { defaultCreateId, isFinitePath, toStock } from "../common";
import { determinant, isSimilarity, type Matrix, multiply, translation } from "../svg/transform";
import { joinPaths } from "./join";
import {
  DxfImportError,
  type DxfPair,
  type DxfRecord,
  decodeDxf,
  decodeName,
  Fields,
  parseNumber,
  readHeader,
  readPairs,
  readSections,
} from "./reader";
import { splineToSegments } from "./spline";

export { DxfImportError } from "./reader";

/**
 * Most entities drawn, counting every copy a block reference makes, so a
 * file whose references fan out can't freeze the import.
 */
export const MAX_DXF_ENTITIES = 200_000;

/** Millimetres per drawing unit for each `$INSUNITS` value; 0 (unitless) and unknown values aren't here. */
export const DXF_UNITS: Readonly<Record<number, number>> = {
  1: MM_PER_INCH,
  2: 12 * MM_PER_INCH,
  3: 63_360 * MM_PER_INCH,
  4: 1,
  5: 10,
  6: 1000,
  7: 1_000_000,
  8: MM_PER_INCH / 1_000_000,
  9: MM_PER_INCH / 1000,
  10: 36 * MM_PER_INCH,
  11: 1e-7,
  12: 1e-6,
  13: 1e-3,
  14: 100,
  15: 10_000,
  16: 100_000,
  17: 1e12,
  18: 1.495978707e14,
  19: 9.4607304725808e18,
  20: 3.085677581491367e19,
  // US survey units: a survey foot is 1200/3937 m.
  21: 1_200_000 / 3937,
  22: 100_000 / 3937,
  23: 3_600_000 / 3937,
  24: 6_336_000_000 / 3937,
};

export type DxfImportOptions = {
  /**
   * What a drawing unit is when the file doesn't say (default `"mm"`).
   * Ask the user when `dxfNeedsUnits` says the file depends on it.
   */
  units?: Units;
  /** Stored as each shape's `source`. */
  fileName?: string;
  /** Id of each new shape (default `crypto.randomUUID`). */
  createId?: () => string;
};

export type DxfImportResult = {
  shapes: Shape[];
  /** What was skipped or assumed, for the user; empty when the file imported as drawn. */
  warnings: string[];
};

/** A parsed DXF file, so it can be checked with `dxfNeedsUnits` and imported without parsing it twice. */
export type DxfDocument = {
  readonly header: Map<string, DxfPair[]>;
  readonly sections: Map<string, DxfRecord[]>;
  /** About decoding the file, passed on with the import's. */
  readonly warnings: readonly string[];
};

/** An entity with the records that belong to it: a POLYLINE's VERTEXes. */
type Entity = { type: string; fields: Fields; vertices: Fields[] };

type Block = { name: string; base: Point; entities: Entity[]; external: boolean };

/**
 * A segment in an entity's own coordinates. Arcs keep their signed sweep in
 * radians (positive counterclockwise), so a full circle is told from a tiny
 * arc and a transform that doesn't keep circles can turn them into cubics.
 */
type RawSegment =
  | { kind: "line"; to: Point }
  | { kind: "arc"; to: Point; center: Point; sweep: number }
  | { kind: "cubic"; c1: Point; c2: Point; to: Point };

type RawPath = { start: Point; segments: RawSegment[]; closed: boolean };

type Context = {
  /** From the current block's coordinates to millimetres, from the file's origin. */
  matrix: Matrix;
  /** Layer of the block reference being drawn, which entities on layer 0 take; `null` at the top level. */
  layer: string | null;
  /** Name of the closest named block being drawn. */
  name: string;
};

/** A path ready to become a shape, or to be joined with others on its layer. */
type Piece = { path: Path; layer: string; name: string };

const FULL_TURN = 2 * Math.PI;

/** Entities that can't become geometry, with what is said when they are skipped. */
const UNSUPPORTED: Record<string, string> = {
  TEXT: "text (convert it to outlines before exporting)",
  MTEXT: "text (convert it to outlines before exporting)",
  ATTDEF: "text (convert it to outlines before exporting)",
  ATTRIB: "text (convert it to outlines before exporting)",
  DIMENSION: "dimensions",
  LEADER: "leaders",
  MLEADER: "leaders",
  MULTILEADER: "leaders",
  TOLERANCE: "dimensions",
  HATCH: "hatches and fills",
  SOLID: "hatches and fills",
  TRACE: "hatches and fills",
  IMAGE: "images",
  WIPEOUT: "images",
  REGION: "solids and regions (explode them into lines and arcs before exporting)",
  "3DSOLID": "solids and regions (explode them into lines and arcs before exporting)",
  BODY: "solids and regions (explode them into lines and arcs before exporting)",
  "3DFACE": "3D faces, meshes and surfaces",
  MESH: "3D faces, meshes and surfaces",
  SURFACE: "3D faces, meshes and surfaces",
  PLANESURFACE: "3D faces, meshes and surfaces",
};

/** Entities that draw nothing in model space, skipped without a word. */
const IGNORED = new Set(["", "VIEWPORT", "SEQEND", "VERTEX", "XLINE", "RAY"]);

const TILTED = "entities not parallel to the XY plane";

/** Parses a DXF file, from its bytes or text. Throws `DxfImportError` if it isn't an ASCII DXF file. */
export function parseDxf(input: string | Uint8Array): DxfDocument {
  const { text, warnings } =
    typeof input === "string" ? { text: input, warnings: [] } : decodeDxf(input);
  const sections = readSections(readPairs(text));
  if (sections.size === 0) throw new DxfImportError("This file isn't a DXF drawing.");
  return { header: readHeader(sections.get("HEADER")), sections, warnings };
}

/** Millimetres per drawing unit as `$INSUNITS` says, or `null` if it is missing, unitless or unknown. */
export function dxfUnitScale({ header }: DxfDocument): number | null {
  const value = header.get("$INSUNITS")?.find((pair) => pair.code === 70)?.value;
  if (value === undefined) return null;
  return DXF_UNITS[Number(value.trim())] ?? null;
}

/**
 * Whether importing the file depends on the units: `$INSUNITS` is missing,
 * unitless or unknown. Then only the user can tell; nothing else in the file
 * says what a drawing unit is.
 */
export function dxfNeedsUnits(dxf: DxfDocument): boolean {
  return dxfUnitScale(dxf) === null;
}

/**
 * Imports a DXF drawing's model space as shapes, keeping its coordinates
 * (scaled to millimetres); the workspace then aligns the drawing to the stock
 * (ADR-0022). Open entities on a layer whose ends meet are joined into one path
 * (`joinPaths`), one shape per path; closed entities and points are a shape
 * each. Arcs and circles stay arcs (unless a block reference stretches them),
 * ellipses and splines become cubics (ADR-0007). Z is ignored; entities on
 * layers that are off or frozen are skipped, and text and the like reported.
 */
export function importDxf(
  dxf: DxfDocument | string,
  options: DxfImportOptions = {},
): DxfImportResult {
  const document = typeof dxf === "string" ? parseDxf(dxf) : dxf;
  const createId = options.createId ?? defaultCreateId;
  const scale = dxfUnitScale(document) ?? (options.units === "in" ? MM_PER_INCH : 1);

  const skipped = new Map<string, number>();
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1);
  const layers = readLayers(document.sections.get("TABLES"));
  /** One spelling per layer, the table's or else the first seen: DXF layer names ignore case. */
  const spelling = (name: string) => {
    const key = name.toLowerCase();
    const known = layers.names.get(key);
    if (known !== undefined) return known;
    layers.names.set(key, name);
    return name;
  };
  const blocks = readBlocks(document.sections.get("BLOCKS"));
  const pieces: Piece[] = [];
  /** Blocks being drawn, to catch references to a block from inside itself. */
  const drawing = new Set<Block>();
  let drawn = 0;
  /** Set when an entity wasn't drawn because the cap was reached. */
  let truncated = false;

  function draw(entity: Entity, context: Context) {
    if (drawn >= MAX_DXF_ENTITIES) {
      truncated = true;
      return;
    }
    drawn++;
    const { type, fields } = entity;
    if (IGNORED.has(type)) return;
    // Invisible entities are never drawn.
    if (fields.number(60, 0) === 1) return;
    if (context.layer === null && fields.number(67, 0) === 1) {
      skip("paper-space entities (layouts)");
      return;
    }
    const ownLayer = spelling(decodeName(fields.text(8) ?? "0"));
    const layer = context.layer !== null && ownLayer === "0" ? context.layer : ownLayer;
    if (layers.hidden.has(layer.toLowerCase())) {
      skip("entities on layers that are off or frozen");
      return;
    }

    if (type === "INSERT") {
      drawInsert(entity, context, layer);
      return;
    }
    const advice = UNSUPPORTED[type];
    if (advice) {
      skip(advice);
      return;
    }

    const shape = entityPaths(entity, skip);
    if (!shape) {
      skip(`${type} entities`);
      return;
    }
    if (shape.tilted) {
      skip(TILTED);
      return;
    }
    if (shape.paths.length === 0) return;
    const matrix = shape.frame ? multiply(context.matrix, shape.frame) : context.matrix;
    const paths = shape.paths.flatMap((raw) => {
      const path = toPath(raw, matrix);
      return path ? [path] : [];
    });
    if (!paths.every(isFinitePath)) {
      skip("entities with invalid or too large coordinates");
      return;
    }
    for (const path of paths) pieces.push({ path, layer, name: context.name });
  }

  function drawInsert(entity: Entity, context: Context, layer: string) {
    const { fields } = entity;
    const block = blocks.get(decodeName(fields.text(2) ?? "").toLowerCase());
    if (!block) {
      skip("references to missing blocks");
      return;
    }
    if (block.external) {
      skip("external references (xrefs)");
      return;
    }
    if (drawing.has(block)) {
      skip("blocks that contain themselves");
      return;
    }
    const { frame, tilted } = objectFrame(fields);
    if (tilted) {
      skip(TILTED);
      return;
    }
    const insertion: Point = [fields.number(10, 0), fields.number(20, 0)];
    const sx = fields.number(41, 1);
    const sy = fields.number(42, 1);
    const angle = (fields.number(50, 0) * Math.PI) / 180;
    const columns = Math.max(1, Math.trunc(fields.number(70, 1)));
    const rows = Math.max(1, Math.trunc(fields.number(71, 1)));
    const columnSpacing = fields.number(44, 0);
    const rowSpacing = fields.number(45, 0);
    if (
      ![...insertion, sx, sy, angle, columns, rows, columnSpacing, rowSpacing].every(
        Number.isFinite,
      )
    ) {
      skip("block references with invalid positions or scales");
      return;
    }
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
    const blockToInsert = multiply(
      [sx, 0, 0, sy, 0, 0],
      translation(-block.base[0], -block.base[1]),
    );
    if (block.entities.length === 0) return;
    const name = block.name.startsWith("*") ? context.name : block.name;
    drawing.add(block);
    // Stop at the cap: an array can ask for 32767 × 32767 copies.
    for (let row = 0; row < rows && !truncated; row++) {
      for (let column = 0; column < columns && !truncated; column++) {
        // Array copies are spaced along the reference's rotated axes, before its scale.
        const placed = multiply(
          multiply(translation(...insertion), rotation),
          multiply(translation(column * columnSpacing, row * rowSpacing), blockToInsert),
        );
        const inner: Context = {
          matrix: multiply(context.matrix, multiply(frame, placed)),
          layer,
          name,
        };
        for (const child of block.entities) draw(child, inner);
      }
    }
    drawing.delete(block);
  }

  const root: Context = { matrix: [scale, 0, 0, scale, 0, 0], layer: null, name: "" };
  for (const entity of groupEntities(document.sections.get("ENTITIES") ?? [])) draw(entity, root);

  const shapes = toShapes(pieces, options.fileName, createId);
  const warnings = [
    ...document.warnings,
    ...Array.from(skipped, ([what, count]) => `Skipped ${what} (${count}).`),
  ];
  if (truncated) {
    warnings.push(
      `The drawing has more than ${MAX_DXF_ENTITIES.toLocaleString("en")} entities, counting repeated copies, so the rest was skipped.`,
    );
  }
  return { shapes, warnings };
}

/**
 * Shapes from pieces in drawing order: closed paths and points one each, open
 * paths joined per layer, a chain taking its pieces' block name if they share one.
 */
function toShapes(pieces: Piece[], fileName: string | undefined, createId: () => string): Shape[] {
  const ordered: { order: number; shape: Omit<Shape, "id"> }[] = [];
  const open = new Map<string, number[]>();
  pieces.forEach((piece, index) => {
    const { path, layer, name } = piece;
    if (path.closed || path.segments.length === 0) {
      ordered.push({ order: index, shape: { name, layer, paths: [path] } });
      return;
    }
    const onLayer = open.get(layer);
    if (onLayer) onLayer.push(index);
    else open.set(layer, [index]);
  });
  for (const [layer, indices] of open) {
    const chains = joinPaths(indices.map((index) => (pieces[index] as Piece).path));
    for (const chain of chains) {
      const names = new Set(
        chain.parts.map((part) => (pieces[indices[part] as number] as Piece).name),
      );
      ordered.push({
        order: indices[chain.parts.reduce((a, b) => Math.min(a, b))] as number,
        shape: {
          name: names.size === 1 ? ([...names][0] as string) : "",
          layer,
          paths: [chain.path],
        },
      });
    }
  }
  ordered.sort((a, b) => a.order - b.order);
  return ordered.map(({ shape }) => ({
    id: createId(),
    name: shape.name,
    layer: shape.layer,
    ...(fileName !== undefined && { source: fileName }),
    paths: shape.paths,
  }));
}

/**
 * An entity's paths in its own coordinates, with `frame` mapping them to its
 * block's when they aren't already in them; `tilted` when it isn't in the XY plane.
 */
type EntityPaths = { paths: RawPath[]; frame?: Matrix; tilted?: boolean };

/** `null` for an entity this importer doesn't know. */
function entityPaths(entity: Entity, skip: (what: string) => void): EntityPaths | null {
  const { type, fields } = entity;
  const n = (code: number, fallback = 0) => fields.number(code, fallback);
  switch (type) {
    case "LINE": {
      const start: Point = [n(10), n(20)];
      return {
        paths: [{ start, segments: [{ kind: "line", to: [n(11), n(21)] }], closed: false }],
      };
    }
    case "POINT":
      return { paths: [{ start: [n(10), n(20)], segments: [], closed: false }] };
    case "CIRCLE": {
      const center: Point = [n(10), n(20)];
      const radius = n(40);
      if (!(radius > 0)) return { paths: [] };
      const start: Point = [center[0] + radius, center[1]];
      return {
        paths: [
          { start, segments: [{ kind: "arc", to: start, center, sweep: FULL_TURN }], closed: true },
        ],
        ...objectFrame(fields),
      };
    }
    case "ARC": {
      const center: Point = [n(10), n(20)];
      const radius = n(40);
      const from = n(50);
      const sweepDegrees = normalizeSweep(n(51) - from, 360);
      if (!(radius > 0) || !(sweepDegrees > 0)) return { paths: [] };
      const at = (degrees: number): Point => [
        center[0] + radius * Math.cos((degrees * Math.PI) / 180),
        center[1] + radius * Math.sin((degrees * Math.PI) / 180),
      ];
      const sweep = (sweepDegrees * Math.PI) / 180;
      const start = at(from);
      const full = sweepDegrees === 360;
      return {
        paths: [
          {
            start,
            segments: [{ kind: "arc", to: full ? start : at(from + sweepDegrees), center, sweep }],
            closed: full,
          },
        ],
        ...objectFrame(fields),
      };
    }
    case "ELLIPSE":
      return ellipsePaths(fields);
    case "LWPOLYLINE": {
      const vertices: { point: Point; bulge: number }[] = [];
      for (const pair of fields.pairs) {
        if (pair.code === 10) vertices.push({ point: [parseNumber(pair.value), 0], bulge: 0 });
        const last = vertices.at(-1);
        if (!last) continue;
        if (pair.code === 20) last.point = [last.point[0], parseNumber(pair.value)];
        else if (pair.code === 42) last.bulge = parseNumber(pair.value);
      }
      return { paths: polylinePaths(vertices, (n(70) & 1) === 1), ...objectFrame(fields) };
    }
    case "POLYLINE": {
      const flags = n(70);
      if (flags & (16 | 64)) {
        skip("3D faces, meshes and surfaces");
        return { paths: [] };
      }
      // Spline-fitted polylines keep the frame they were fitted to as vertices flagged 16.
      const vertices = entity.vertices
        .filter((vertex) => (vertex.number(70, 0) & 16) === 0)
        .map((vertex) => ({
          point: [vertex.number(10, 0), vertex.number(20, 0)] as Point,
          bulge: vertex.number(42, 0),
        }));
      const paths = polylinePaths(vertices, (flags & 1) === 1);
      // 3D polylines are in world coordinates, 2D ones in their own.
      return (flags & 8) !== 0 ? { paths } : { paths, ...objectFrame(fields) };
    }
    case "SPLINE": {
      const controlPoints = pointsOf(fields.pairs, 10, 20);
      if (controlPoints.length === 0) {
        skip("splines defined only by fit points (save them with control points)");
        return { paths: [] };
      }
      const converted = splineToSegments({
        degree: n(71),
        knots: fields.numbers(40),
        controlPoints,
        weights: fields.numbers(41),
      });
      if (!converted) {
        skip("invalid splines");
        return { paths: [] };
      }
      return { paths: [{ ...converted, closed: false }] };
    }
    default:
      return null;
  }
}

/** An ELLIPSE as the unit circle stretched onto it, so a circle stays an arc. */
function ellipsePaths(fields: Fields): EntityPaths {
  const n = (code: number, fallback = 0) => fields.number(code, fallback);
  const normal = extrusion(fields);
  const major: [number, number, number] = [n(11), n(21), n(31)];
  const ratio = n(40, 1);
  // The minor axis is the normal × the major axis, scaled by the ratio.
  const minor: Point = [
    ratio * (normal[1] * major[2] - normal[2] * major[1]),
    ratio * (normal[2] * major[0] - normal[0] * major[2]),
  ];
  const frame: Matrix = [major[0], major[1], minor[0], minor[1], n(10), n(20)];
  // Its points are in world coordinates, but its plane is still the extrusion's.
  if (objectFrame(fields).tilted) return { paths: [], tilted: true };
  const from = n(41, 0);
  const sweep = normalizeSweep(n(42, FULL_TURN) - from, FULL_TURN);
  if (!(ratio > 0) || !(sweep > 0) || determinant(frame) === 0) return { paths: [], frame };
  const start: Point = [Math.cos(from), Math.sin(from)];
  const full = sweep === FULL_TURN;
  const to: Point = full ? start : [Math.cos(from + sweep), Math.sin(from + sweep)];
  return {
    paths: [{ start, segments: [{ kind: "arc", to, center: [0, 0], sweep }], closed: full }],
    frame,
  };
}

/**
 * A sweep from end minus start, in `(0, turn]`, or 0 when they are equal. A
 * difference of a full turn or more is a full turn: writers round 360° and 2π
 * either way, and wrapping 2π + 1e-15 would leave an arc of almost nothing.
 */
function normalizeSweep(sweep: number, turn: number): number {
  if (!Number.isFinite(sweep)) return Number.NaN;
  if (sweep === 0) return 0;
  if (Math.abs(sweep) >= turn) return turn;
  let result = sweep % turn;
  if (result <= 0) result += turn;
  return result;
}

/** A polyline's path, its bulges as arcs: a bulge is the tangent of a quarter of the arc's sweep. */
function polylinePaths(vertices: { point: Point; bulge: number }[], closed: boolean): RawPath[] {
  const [first] = vertices;
  // A single vertex draws nothing; drill points are POINT entities.
  if (!first || vertices.length < 2) return [];
  const segments: RawSegment[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const { point: from, bulge } = vertices[i] as { point: Point; bulge: number };
    const to = (vertices[(i + 1) % vertices.length] as { point: Point }).point;
    segments.push(bulgeSegment(from, to, bulge));
  }
  return [{ start: first.point, segments, closed }];
}

function bulgeSegment(from: Point, to: Point, bulge: number): RawSegment {
  if (!Number.isFinite(bulge) || bulge === 0) return { kind: "line", to };
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  // From the chord's midpoint, the centre is along its left normal (bulge > 0 turns left).
  const offset = (1 - bulge * bulge) / (4 * bulge);
  const center: Point = [(from[0] + to[0]) / 2 - offset * dy, (from[1] + to[1]) / 2 + offset * dx];
  return { kind: "arc", to, center, sweep: 4 * Math.atan(bulge) };
}

/**
 * The XY projection of an entity's object coordinate system, from its
 * extrusion direction by DXF's arbitrary axis algorithm (mirrored for an
 * extrusion of -Z), and whether the entity is tilted out of the XY plane,
 * when the projection doesn't keep circles circular.
 */
function objectFrame(fields: Fields): { frame: Matrix; tilted: boolean } {
  const [nx, ny, nz] = extrusion(fields);
  let ax: [number, number, number];
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) ax = [nz, 0, -nx];
  else ax = [-ny, nx, 0];
  const length = Math.hypot(...ax);
  ax = [ax[0] / length, ax[1] / length, ax[2] / length];
  const ay = [ny * ax[2] - nz * ax[1], nz * ax[0] - nx * ax[2]];
  const frame: Matrix = [ax[0], ax[1], ay[0] as number, ay[1] as number, 0, 0];
  return { frame, tilted: !isSimilarity(frame) };
}

/** The unit extrusion direction, (0, 0, 1) unless the entity gives a valid one. */
function extrusion(fields: Fields): [number, number, number] {
  const n: [number, number, number] = [
    fields.number(210, 0),
    fields.number(220, 0),
    fields.number(230, 1),
  ];
  const length = Math.hypot(...n);
  if (!(length > 0) || !Number.isFinite(length)) return [0, 0, 1];
  return [n[0] / length, n[1] / length, n[2] / length];
}

/** Points from pairs of `x` and `y` codes, in order. */
function pointsOf(pairs: DxfPair[], xCode: number, yCode: number): Point[] {
  const points: Point[] = [];
  for (const pair of pairs) {
    if (pair.code === xCode) points.push([parseNumber(pair.value), 0]);
    else if (pair.code === yCode && points.length > 0) {
      const last = points.at(-1) as Point;
      points[points.length - 1] = [last[0], parseNumber(pair.value)];
    }
  }
  return points;
}

/**
 * A path in millimetres, without the zero-length segments the document
 * rejects; `null` if nothing is left of it. Arcs become cubics when `matrix`
 * doesn't keep circles circular.
 */
function toPath(raw: RawPath, matrix: Matrix): Path | null {
  const start = toStock(matrix, raw.start);
  const mirrored = determinant(matrix) < 0;
  const keepsCircles = isSimilarity(matrix);
  const segments: Segment[] = [];
  let current = start;
  let local = raw.start;
  const push = (segment: Segment) => {
    segments.push(segment);
    current = segment.to;
  };
  for (const segment of raw.segments) {
    const to = toStock(matrix, segment.to);
    if (segment.kind === "line") {
      if (!pointsCoincide(current, to)) push({ kind: "line", to });
    } else if (segment.kind === "cubic") {
      const c1 = toStock(matrix, segment.c1);
      const c2 = toStock(matrix, segment.c2);
      if (![c1, c2, to].every((p) => pointsCoincide(current, p)))
        push({ kind: "cubic", c1, c2, to });
    } else {
      const center = toStock(matrix, segment.center);
      // Ends that meet after more than half a turn are a full circle with its end rounded off.
      const full =
        Math.abs(segment.sweep) >= FULL_TURN ||
        (Math.abs(segment.sweep) > Math.PI && pointsCoincide(current, to));
      if (!full && pointsCoincide(current, to)) {
        // Too short to keep: an arc ending where it starts would be a full circle.
      } else if (keepsCircles) {
        if (distance(center, current) > GEOMETRY_TOLERANCE) {
          const end = full ? current : to;
          push({ kind: "arc", to: end, center, clockwise: segment.sweep < 0 !== mirrored });
        } else if (!pointsCoincide(current, to)) {
          push({ kind: "line", to });
        }
      } else {
        for (const cubic of arcCubics(local, segment)) {
          const c1 = toStock(matrix, cubic.c1);
          const c2 = toStock(matrix, cubic.c2);
          const end = toStock(matrix, cubic.to);
          if (![c1, c2, end].every((p) => pointsCoincide(current, p)))
            push({ kind: "cubic", c1, c2, to: end });
        }
      }
    }
    local = segment.to;
  }
  if (segments.length === 0) {
    return raw.segments.length === 0 ? { start, segments: [], closed: false } : null;
  }
  const closed = raw.closed && !(segments.length === 1 && segments[0]?.kind === "line");
  return { start, segments, closed };
}

/** A circular arc from `from` as cubics of at most a quarter turn each. */
function arcCubics(
  from: Point,
  arc: { to: Point; center: Point; sweep: number },
): { c1: Point; c2: Point; to: Point }[] {
  const [cx, cy] = arc.center;
  const radius = Math.hypot(from[0] - cx, from[1] - cy);
  const startAngle = Math.atan2(from[1] - cy, from[0] - cx);
  const count = Math.max(1, Math.ceil(Math.abs(arc.sweep) / (Math.PI / 2) - 1e-9));
  const step = arc.sweep / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): Point => [cx + radius * Math.cos(t), cy + radius * Math.sin(t)];
  const tangent = (t: number): Point => [-radius * Math.sin(t), radius * Math.cos(t)];
  const cubics: { c1: Point; c2: Point; to: Point }[] = [];
  let start = from;
  for (let i = 0; i < count; i++) {
    const t0 = startAngle + i * step;
    const t1 = t0 + step;
    const end = i === count - 1 ? arc.to : at(t1);
    const d0 = tangent(t0);
    const d1 = tangent(t1);
    cubics.push({
      c1: [start[0] + k * d0[0], start[1] + k * d0[1]],
      c2: [end[0] - k * d1[0], end[1] - k * d1[1]],
      to: end,
    });
    start = end;
  }
  return cubics;
}

/** Entities in order, each POLYLINE with its VERTEXes and each INSERT without its ATTRIBs. */
function groupEntities(records: DxfRecord[]): Entity[] {
  const entities: Entity[] = [];
  let owner: Entity | null = null;
  for (const record of records) {
    const fields = new Fields(record.pairs);
    if (owner) {
      if (record.type === "VERTEX") {
        owner.vertices.push(fields);
        continue;
      }
      if (record.type === "ATTRIB") continue;
      owner = null;
      if (record.type === "SEQEND") continue;
    }
    const entity: Entity = { type: record.type, fields, vertices: [] };
    entities.push(entity);
    if (record.type === "POLYLINE" || (record.type === "INSERT" && fields.number(66, 0) === 1)) {
      owner = entity;
    }
  }
  return entities;
}

/** Blocks by lower-case name (DXF names ignore case). */
function readBlocks(records: DxfRecord[] | undefined): Map<string, Block> {
  const blocks = new Map<string, Block>();
  let current: { block: Block; records: DxfRecord[] } | null = null;
  for (const record of records ?? []) {
    if (record.type === "BLOCK") {
      const fields = new Fields(record.pairs);
      const name = decodeName(fields.text(2) ?? "");
      const block: Block = {
        name,
        base: [fields.number(10, 0), fields.number(20, 0)],
        entities: [],
        // Bit 4 marks an external reference, bit 8 one overlaid from it.
        external: (fields.number(70, 0) & (4 | 8)) !== 0,
      };
      current = { block, records: [] };
      if (!blocks.has(name.toLowerCase())) blocks.set(name.toLowerCase(), block);
    } else if (record.type === "ENDBLK") {
      if (current) current.block.entities = groupEntities(current.records);
      current = null;
    } else {
      current?.records.push(record);
    }
  }
  return blocks;
}

/**
 * The layer table: each layer's spelling by lower-case name, and the
 * lower-case names of those that are off (negative colour) or frozen (flag 1).
 */
function readLayers(records: DxfRecord[] | undefined): {
  names: Map<string, string>;
  hidden: Set<string>;
} {
  const names = new Map<string, string>();
  const hidden = new Set<string>();
  for (const record of records ?? []) {
    if (record.type !== "LAYER") continue;
    const fields = new Fields(record.pairs);
    const name = fields.text(2);
    if (name === undefined) continue;
    const decoded = decodeName(name);
    if (!names.has(decoded.toLowerCase())) names.set(decoded.toLowerCase(), decoded);
    if (fields.number(62, 7) < 0 || (fields.number(70, 0) & 1) !== 0)
      hidden.add(decoded.toLowerCase());
  }
  return { names, hidden };
}
