import type {
  FinishingStrategy,
  Model,
  PocketOperation,
  PocketParams,
  ReliefFinishOperation,
  Shape,
  Tool,
} from "@furrow/document";
import { DRAWING_ID, model as modelFixture } from "@furrow/document/fixtures";
import { expect } from "vitest";
import { modelView } from "../scene/sides";
import type { Vec3 } from "../scene/stock";
import { cutterProfile, type HeightmapGrid, sweepMoves } from "../simulation/simulation";
import {
  modelHeightsSteps,
  reliefCellSize,
  reliefGrid,
  runSteps,
  ToolDropper,
} from "./relief/finish";
import type { Toolpath, ToolpathMove } from "./toolpath";

// Checks for the moves a toolpath makes without retracting (#574): a feed
// that stays down between cuts must never go below the surface it passes over.

/** A horizontal rectangle at height `z`, as two triangles. */
export function rect(x0: number, y0: number, x1: number, y1: number, z: number): number[] {
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];
}

/** A vertical wall along Y at `x`, from `z0` up to `z1`: seen edge-on from above. */
export function wall(x: number, y0: number, y1: number, z0: number, z1: number): number[] {
  return [x, y0, z0, x, y1, z0, x, y1, z1, x, y0, z0, x, y1, z1, x, y0, z1];
}

/** A model whose mesh coordinates are its stock coordinates, its top at the stock top. */
export function placed(width: number, length: number, depth: number): Model {
  return {
    ...modelFixture,
    bounds: { min: [0, 0, -depth], max: [width, length, 0] },
    placement: { rotation: [0, 0, 0], scale: 1, depth, top: 0, position: [0, 0] },
  };
}

/** A 20 × 20 pyramid, 8 mm high, its apex at the stock top. */
export const PYRAMID = placed(20, 20, 8);
export const pyramidMesh = new Float32Array([
  ...[0, 0, -8, 20, 0, -8, 10, 10, 0],
  ...[20, 0, -8, 20, 20, -8, 10, 10, 0],
  ...[20, 20, -8, 0, 20, -8, 10, 10, 0],
  ...[0, 20, -8, 0, 0, -8, 10, 10, 0],
]);

/** A 20 × 10 × 10 model: a plateau 4 mm below the top over x < 10, the floor at -10 beyond. */
export const STEP = placed(20, 10, 10);
export const stepMesh = new Float32Array([
  ...rect(0, 0, 20, 10, -10),
  ...rect(0, 0, 10, 10, -4),
  ...wall(10, 0, 10, -10, -4),
  ...rect(19.99, 9.99, 20, 10, 0),
]);

/**
 * Two pits 8 mm deep either side of a 4 mm wide ridge 2 mm below the top:
 * the contours either side of the ridge are in a flat end mill's reach of
 * each other, but the straight way between them is through the ridge.
 */
export const RIDGE = placed(24, 10, 8);
export const ridgeMesh = new Float32Array([
  ...rect(0, 0, 24, 10, -8),
  ...rect(10, 0, 14, 10, -2),
  ...wall(10, 0, 10, -8, -2),
  ...wall(14, 0, 10, -8, -2),
  ...rect(23.99, 9.99, 24, 10, 0),
]);

/** Two 4 mm high pyramids on a floor 8 mm down, their bases 8 mm apart: contours and laps either side of a valley. */
export const TWIN = placed(30, 12, 8);
export const twinMesh = new Float32Array([
  ...rect(0, 0, 30, 12, -8),
  ...[1, 1, -8, 11, 1, -8, 6, 6, -4],
  ...[11, 1, -8, 11, 11, -8, 6, 6, -4],
  ...[11, 11, -8, 1, 11, -8, 6, 6, -4],
  ...[1, 11, -8, 1, 1, -8, 6, 6, -4],
  ...[19, 1, -8, 29, 1, -8, 24, 6, -4],
  ...[29, 1, -8, 29, 11, -8, 24, 6, -4],
  ...[29, 11, -8, 19, 11, -8, 24, 6, -4],
  ...[19, 11, -8, 19, 1, -8, 24, 6, -4],
]);

/** A closed shape through `corners`, from the first. */
export function polygonShape(id: string, corners: [number, number][]): Shape {
  const [start = [0, 0], ...rest] = corners;
  return {
    id,
    name: "Polygon",
    layer: "0",
    drawingId: DRAWING_ID,
    paths: [{ start, segments: rest.map((to) => ({ kind: "line" as const, to })), closed: true }],
  };
}

/** A `width` × `height` rectangle from `[x, y]`. */
export function rectangle(id: string, x: number, y: number, width: number, height: number): Shape {
  return polygonShape(id, [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ]);
}

/** 100 × 100 mm. */
export const square = rectangle("4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b", 0, 0, 100, 100);

/** Radius 10 around (50, 50), drawn as its own shape: an island in the square. */
export const island: Shape = {
  id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  name: "Island",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [
    {
      start: [60, 50],
      segments: [{ kind: "arc", to: [60, 50], center: [50, 50], clockwise: false }],
      closed: true,
    },
  ],
};

/**
 * Two 40 mm squares joined by a 7 mm neck: wider than the 6 mm tool, too
 * narrow for clearing 1 mm of allowance off both walls.
 */
export const dumbbell = polygonShape("0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a", [
  [0, 0],
  [40, 0],
  [40, 16.5],
  [60, 16.5],
  [60, 0],
  [100, 0],
  [100, 40],
  [60, 40],
  [60, 23.5],
  [40, 23.5],
  [40, 40],
  [0, 40],
]);

/** A 6 mm flat end mill cutting 2 mm a level. */
export const pocketTool: Tool = {
  name: "6 mm upcut",
  type: "flat_end_mill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  taperAngle: null,
  spindleRpm: 18000,
  feedRate: 1500,
  plungeRate: 500,
  plungeAngle: 3,
  stepDown: 2,
  notes: null,
  color: "#2563eb",
};

/** A pocket 6 mm deep of `shapes` with `pocketTool`, changed by `params` and `toolOverrides`. */
export function pocketOperation(
  params: Partial<PocketParams> = {},
  shapes: Shape[] = [square],
  toolOverrides: Partial<Tool> = {},
): PocketOperation {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    name: "Pocket",
    enabled: true,
    stockSide: "top",
    type: "pocket",
    targets: shapes.map((shape) => ({ shapeId: shape.id, paths: null })),
    tool: { ...pocketTool, ...toolOverrides },
    params: {
      side: "inside",
      strategy: { type: "offset" },
      direction: "climb",
      stepOver: 40,
      depth: 6,
      allowance: 0,
      finishPass: false,
      ramp: false,
      ...params,
    },
  };
}

/**
 * Rapids that go up, to the retract height or the entry clearance: every
 * time the tool leaves the cut. (`pocket.test.ts` counts only those up to
 * the retract height.)
 */
export const lifts = ({ moves }: Toolpath) =>
  moves.filter((move, i) => move.kind === "rapid" && move.to[2] > (moves[i - 1]?.to[2] ?? Infinity))
    .length;

/** The machine's heights for the relief tests: a 5 mm retract height, 1 mm entry clearance. */
export const reliefOptions = { safeZ: 5, entryClearance: 1 };

/**
 * Tools are dropped onto cell centres (ADR-0030), so a flat end mill's rim
 * may reach up to a cell's worth of a slope between them: the pyramid's faces
 * rise 0.8 in 1, over 0.1 mm cells.
 */
export const SAMPLING = 0.8 * 0.1 + 0.005;

/** A finishing operation over the models here (they share the fixture's id) with `strategy`. */
export function finishing(
  tool: Tool,
  strategy: FinishingStrategy,
  params: Partial<ReliefFinishOperation["params"]> = {},
): ReliefFinishOperation {
  return {
    id: "7c1e4b2a-9d3f-4a6e-8b5c-2f0e1d9a8b7c",
    type: "relief_finish",
    name: "Finish",
    enabled: true,
    stockSide: "top",
    targets: [],
    tool,
    params: {
      modelId: modelFixture.id,
      strategy,
      stepOver: 20,
      stockToLeave: 0,
      boundary: { type: "model" },
      rest: false,
      ...params,
    },
  };
}

/** A move in plan, from one point to another. */
export type Segment = [[number, number], [number, number]];

/** Consecutive moves as `[from, move]`, starting from the first move's target. */
export function steps(toolpath: Toolpath): [Vec3, ToolpathMove][] {
  const result: [Vec3, ToolpathMove][] = [];
  let from: Vec3 | null = null;
  for (const move of toolpath.moves) {
    if (from) result.push([from, move]);
    from = move.to;
  }
  return result;
}

/** Feed moves that stay at height `z`, as 2D segments. */
export function cutsAt(toolpath: Toolpath, z: number): Segment[] {
  return steps(toolpath)
    .filter(([from, move]) => move.kind === "feed" && from[2] === z && move.to[2] === z)
    .map(([from, move]) => [
      [from[0], from[1]],
      [move.to[0], move.to[1]],
    ]);
}

export function distanceToSegment(point: [number, number], [a, b]: Segment): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared))
      : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

/** Side of the cells `widestCut` files cuts under: how far it measures exactly. */
const WIDTH_REACH = 5;

/**
 * How far from the cuts before it at `z` the tool centre gets, every
 * millimetre along each cut, the points `starting` holds for left out: how
 * wide it cuts sideways, exactly up to `WIDTH_REACH` and more than that
 * beyond. A link fed at depth through stock not yet cleared at `z` is as
 * wide as the stock it crosses.
 */
export function widestCut(
  toolpath: Toolpath,
  z: number,
  starting: (point: [number, number]) => boolean,
): number {
  const cuts = cutsAt(toolpath, z);
  // Each cut filed under every cell it comes within a cell's side of, so a
  // point's own cell holds every earlier cut within `WIDTH_REACH` of it.
  const cells = new Map<string, Segment[]>();
  const cellOf = (x: number, y: number) =>
    `${Math.floor(x / WIDTH_REACH)},${Math.floor(y / WIDTH_REACH)}`;
  const file = (cut: Segment) => {
    const [[ax, ay], [bx, by]] = cut;
    const first = (v: number) => Math.floor(v / WIDTH_REACH) - 1;
    const last = (v: number) => Math.floor(v / WIDTH_REACH) + 1;
    for (let i = first(Math.min(ax, bx)); i <= last(Math.max(ax, bx)); i++) {
      for (let j = first(Math.min(ay, by)); j <= last(Math.max(ay, by)); j++) {
        const cell = cells.get(`${i},${j}`) ?? [];
        cell.push(cut);
        cells.set(`${i},${j}`, cell);
      }
    }
  };
  let widest = 0;
  for (const [i, cut] of cuts.entries()) {
    const [a, b] = cut;
    const count = Math.max(4, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let k = 1; k <= count; k++) {
      const t = k / count;
      const point: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (starting(point)) continue;
      // Along a cut, its own start; the first cut of a level has nothing before it.
      let nearest = i === 0 ? Infinity : Math.hypot(point[0] - a[0], point[1] - a[1]);
      for (const earlier of cells.get(cellOf(...point)) ?? []) {
        nearest = Math.min(nearest, distanceToSegment(point, earlier));
      }
      widest = Math.max(widest, nearest);
    }
    file(cut);
  }
  return widest;
}

/**
 * Fails if a cut of `toolpath` below the top, at any of `levels`, is wider
 * than `stepOver` after the points `starting` holds for (`widestCut`), give
 * or take the chord tolerance curves are drawn to.
 */
export function expectNoWideCut(
  toolpath: Toolpath,
  levels: number[],
  stepOver: number,
  starting: (point: [number, number]) => boolean,
) {
  for (const z of levels) {
    expect(cutsAt(toolpath, z).length).toBeGreaterThan(0);
    expect(widestCut(toolpath, z, starting)).toBeLessThanOrEqual(stepOver + 2e-2);
  }
}

/** `toolpath` from its first move below `z`: below the first level, where the stock above is cleared. */
export function below(toolpath: Toolpath, z: number): Toolpath {
  const first = toolpath.moves.findIndex((move) => move.to[2] < z - 1e-9);
  expect(first).toBeGreaterThanOrEqual(0);
  return { ...toolpath, moves: toolpath.moves.slice(first) };
}

/** Every move of `toolpath` as segments for the simulation, six numbers each. */
export function segmentsOf({ moves }: Toolpath): Float32Array {
  const segments: number[] = [];
  for (let i = 1; i < moves.length; i++) {
    segments.push(...(moves[i - 1]?.to ?? []), ...(moves[i]?.to ?? []));
  }
  return new Float32Array(segments);
}

/**
 * Fails if any feed of `toolpath` (cuts, links, plunges) goes more than
 * `tolerance` below the lowest the tool may go over the model: the tool
 * dropped onto it, on the toolpath's cells, every 0.05 mm along the move.
 * Models sit at the stock's corner, so stock and grid coordinates are the same. Returns how many feeds at
 * the feed rate go up or down: the links between levels.
 */
export function expectFeedsAboveModel(
  toolpath: Toolpath,
  tool: Tool,
  model: Model,
  mesh: Float32Array,
  tolerance: number,
): number {
  const view = modelView(model);
  const grid = reliefGrid(view, 0, reliefCellSize(tool));
  if (!grid) throw new Error("no grid");
  const heights = runSteps(modelHeightsSteps(view, mesh, grid, 0, undefined));
  const dropper = new ToolDropper(heights, grid, cutterProfile(tool));
  const floor = model.bounds.min[2];
  let deepest = -Infinity;
  let links = 0;
  const { moves } = toolpath;
  for (let i = 1; i < moves.length; i++) {
    const move = moves[i];
    const from = moves[i - 1]?.to;
    if (!move || !from || move.kind !== "feed") continue;
    const [ax, ay, az] = from;
    const [bx, by, bz] = move.to;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05));
    if (Math.abs(bz - az) > 1e-9 && move.feedRate === tool.feedRate) links++;
    for (let k = 0; k <= steps; k++) {
      const s = k / steps;
      const tip = dropper.dropPoint(ax + (bx - ax) * s, ay + (by - ay) * s, floor);
      deepest = Math.max(deepest, tip - (az + (bz - az) * s));
    }
  }
  expect(deepest).toBeLessThanOrEqual(tolerance);
  return links;
}

/**
 * Fails if a move of `toolpath` along the stock cuts deeper than the tool's
 * step-down: each move simulated in turn, on 0.25 mm cells, over the stock
 * `width` × `length` from its corner. A link fed at depth through stock the
 * level above hasn't cleared, or one dropping into it, cuts deeper; one at
 * the depth of the level just above is caught by `expectNoWideCut`. Plunges
 * straight down are left out, with 0.1 mm of slack on the step-down.
 */
export function expectNoLinkThroughStock(
  toolpath: Toolpath,
  tool: Tool,
  width: number,
  length: number,
) {
  const cell = 0.25;
  const grid: HeightmapGrid = {
    columns: Math.ceil(width / cell),
    rows: Math.ceil(length / cell),
    cellWidth: cell,
    cellHeight: cell,
  };
  const heights = new Float32Array(grid.columns * grid.rows);
  const profile = cutterProfile(tool);
  const reach = tool.diameter / 2 + cell;
  let deepest = 0;
  const { moves } = toolpath;
  for (let i = 1; i < moves.length; i++) {
    const from = moves[i - 1]?.to;
    const move = moves[i];
    if (!from || !move) continue;
    const segment = new Float32Array([...from, ...move.to]);
    const along = Math.hypot(move.to[0] - from[0], move.to[1] - from[1]) > 1e-9;
    // The cells the move may reach, before it.
    const c0 = Math.max(0, Math.floor((Math.min(from[0], move.to[0]) - reach) / cell));
    const c1 = Math.min(
      grid.columns - 1,
      Math.ceil((Math.max(from[0], move.to[0]) + reach) / cell),
    );
    const r0 = Math.max(0, Math.floor((Math.min(from[1], move.to[1]) - reach) / cell));
    const r1 = Math.min(grid.rows - 1, Math.ceil((Math.max(from[1], move.to[1]) + reach) / cell));
    const before: number[] = [];
    if (along) {
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) before.push(heights[r * grid.columns + c] as number);
      }
    }
    sweepMoves(grid, heights, profile, segment, 0, 1);
    if (!along) continue;
    let k = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cut = (before[k++] as number) - (heights[r * grid.columns + c] as number);
        deepest = Math.max(deepest, cut);
      }
    }
  }
  expect(deepest).toBeGreaterThan(0);
  expect(deepest).toBeLessThanOrEqual(tool.stepDown + 0.1);
}
