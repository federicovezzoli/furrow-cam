import {
  anchorPoint,
  closedLoops,
  DEFAULT_CHORD_TOLERANCE,
  drawingFit,
  holeSnapTargets,
  MIN_LENGTH,
  mapPlacement,
  mapShapes,
  mapText,
  mirrorPoint,
  nearestHoleSnap,
  nearestOnLoops,
  type Rect,
  rotatePoint,
  roundCoordinate,
  type SnapEdge,
  type SnapTarget,
  scalePoint,
  scaleShapes,
  shapesBounds,
  snapEdges,
  startPointPaths,
  stockInset,
  targetedShapes,
  translatePoint,
  translateShapes,
  xyOriginPosition,
} from "@furrow/cam-core";
import {
  DRAWING_BORDER,
  type Drawing,
  distance,
  GEOMETRY_TOLERANCE,
  type Message,
  type Operation,
  type Path,
  type PatternSettings,
  type Point,
  type ProfileStartPoint,
  type ProjectDocument,
  Sha256,
  type Shape,
  type Stock,
  segmentIssue,
  type TextSettings,
} from "@furrow/document";
import type { Draft } from "immer";
import { generatePattern, stalePatterns } from "../lib/patterns";
import { FONT_REMOVED } from "../lib/text-layout";
import type { DocumentState, DocumentStore } from "./document-store";
import { modelAnchor } from "./model-actions";
import { type ActionResult, hasPlacedHoles } from "./operation-actions";

/** The new drawing an import's shapes name, called after their file. */
function importedDrawing(shapes: Shape[]): Drawing | null {
  const [first] = shapes;
  if (!first) return null;
  return { id: first.drawingId, name: first.source ?? "", border: DRAWING_BORDER, rotation: 0 };
}

/**
 * Adds an imported file's shapes as a new drawing (ADR-0055), as one undo
 * step, at its size in the file, placed as `placeDrawing` does. The shapes
 * all name the new drawing, as an import gives them, and it takes its name
 * from their file. Returns `false`, adding nothing, if `shapes` has no
 * geometry. `name` labels the change, e.g. `importSvg`.
 */
export function addImportedShapes(store: DocumentStore, name: string, shapes: Shape[]): boolean {
  const drawing = importedDrawing(shapes);
  return drawing !== null && placeDrawing(store, name, drawing, shapes);
}

/** A text item's name: its text on one line, its lines joined by spaces. */
function textName(text: string): string {
  return text.trim().replace(/\s*[\r\n]+\s*/g, " ");
}

/** Why text can't be added or changed: the font has none of its characters. */
export const TEXT_NO_OUTLINES: Message = { code: "workspace.textNoOutlines" };

/**
 * Adds a text item (ADR-0059) as one undo step: `text`'s settings with
 * `paths`, its outlines laid out at its placement, as its one shape, placed
 * as `placeDrawing` does and named after its text. Returns its id; adds
 * nothing if it has no outlines.
 */
export function addTextItem(
  store: DocumentStore,
  text: TextSettings,
  paths: Path[],
): { ok: true; id: string } | { ok: false; error: Message } {
  if (paths.length === 0) return { ok: false, error: TEXT_NO_OUTLINES };
  const id = crypto.randomUUID();
  const shape: Shape = { id: crypto.randomUUID(), name: "", layer: "", drawingId: id, paths };
  const drawing = { id, name: textName(text.text), border: DRAWING_BORDER, rotation: 0, text };
  return placeDrawing(store, "addText", drawing, [shape])
    ? { ok: true, id }
    : { ok: false, error: TEXT_NO_OUTLINES };
}

/**
 * Adds `drawing` and its `shapes` as one undo step, aligned on its own at the
 * XY zero's anchor (bottom-left for a custom zero) to the stock less the
 * drawing's border, the rectangle *Fit to stock* fits into (PRD-0009 D1): it
 * may overlap what the project already holds. A text item's placement moves
 * with its outlines. Returns `false`, adding nothing, if the shapes have no
 * geometry.
 */
function placeDrawing(
  store: DocumentStore,
  name: string,
  drawing: Drawing,
  shapes: Shape[],
): boolean {
  const { document } = store.getState();
  const bounds = shapesBounds(shapes);
  if (!bounds) return false;
  const { stock } = document;
  const anchor = modelAnchor(stock);
  const [x, y] = anchorPoint(stockInset(stock, DRAWING_BORDER), anchor);
  const [bx, by] = anchorPoint(bounds, anchor);
  const offset: Point = [x - bx, y - by];
  const moved = { ...drawing };
  moveSettingsWithShapes(moved, (point) => translatePoint(point, offset));
  addDrawing(store, name, moved, translateShapes(shapes, offset));
  return true;
}

/** Adds `drawing` and its `shapes`, as they are, as one undo step. */
export function addDrawing(store: DocumentStore, name: string, drawing: Drawing, shapes: Shape[]) {
  // One assignment, not a spread push: a file may hold more shapes than a call takes arguments.
  const geometry = store.getState().document.geometry.concat(shapes);
  store.getState().change(name, (draft) => {
    draft.drawings.push(drawing);
    draft.geometry = geometry;
  });
}

/** How far off a text item's new outlines a tab may lie and stay: the flattening's chords, and float noise. */
const TAB_ON_OUTLINE = DEFAULT_CHORD_TOLERANCE + GEOMETRY_TOLERANCE;

/**
 * Sets text item `id`'s settings to `text` and its outlines to `paths`, laid
 * out from them, as one undo step (ADR-0059). Its shape keeps its id, so the
 * operations machining it still do; their targets listing some of its paths
 * take all of them, as the old paths' numbers mean nothing in the new ones.
 * The profile tabs on its old paths stay if they lie on the new ones, and
 * go otherwise: `removedTabs` counts them. Refuses, changing nothing, text
 * with no outlines.
 */
export function setTextItem(
  store: DocumentStore,
  id: string,
  text: TextSettings,
  paths: Path[],
): { ok: true; removedTabs: number } | { ok: false; error: Message } {
  if (paths.length === 0) return { ok: false, error: TEXT_NO_OUTLINES };
  const { document } = store.getState();
  // An uploaded font the project no longer lists, e.g. its upload undone meanwhile, would leave it invalid.
  if (
    Sha256.safeParse(text.font).success &&
    !document.fonts.some(({ sha256 }) => sha256 === text.font)
  ) {
    return { ok: false, error: FONT_REMOVED };
  }
  const drawing = document.drawings.find((d) => d.id === id && d.text);
  const [shape] = drawingShapes(document.geometry, id);
  if (!drawing || !shape) return { ok: true, removedTabs: 0 };
  // The patterns its letters bound fill the new ones (ADR-0087); one that no longer fits keeps its cells.
  const derived = new Map([[id, paths]]);
  const geometry = document.geometry.map((s) => (s === shape ? { ...shape, paths } : s));
  const followers = followPatterns(store, document, geometry, new Set([shape.id]), derived, {
    renumbered: true,
  });
  const change = derivedPathsChange(document, derived);
  store.getState().change("setText", (draft) => {
    const d = draft.drawings.find(({ id: candidate }) => candidate === id);
    if (d) Object.assign(d, { name: textName(text.text), text });
    for (const follower of draft.drawings) {
      const settings = followers.get(follower.id);
      if (settings) follower.pattern = settings;
    }
    change.apply(draft);
  });
  return { ok: true, removedTabs: change.removedTabs };
}

/**
 * The change that sets the paths of the one shape of each drawing in
 * `derived`, a text item's outlines or a pattern's cells, derived again from
 * their settings (ADR-0059, ADR-0087). The shapes keep their ids, so the
 * operations machining them still do; their targets listing some of their
 * paths take all of them, as do pattern boundaries on them, since the old
 * paths' numbers mean nothing in the new ones. The profile tabs on their old
 * paths, first moved by `move` when they moved too, stay if they lie on the
 * new ones and go otherwise: `removedTabs` counts them.
 */
export function derivedPathsChange(
  document: ProjectDocument,
  derived: ReadonlyMap<string, Path[]>,
  move: (point: Point) => Point = (point) => point,
): { removedTabs: number; apply: (draft: Draft<ProjectDocument>) => void } {
  const changed: { index: number; shape: Shape; paths: Path[] }[] = [];
  const shapeIds = new Set<string>();
  /** Per profile, which of its tabs lie on the changed shapes' old paths, and which of those go. */
  const owned = new Map<string, boolean[]>();
  const gone = new Map<string, boolean[]>();
  for (const [id, paths] of derived) {
    const [shape] = drawingShapes(document.geometry, id);
    if (!shape) continue;
    changed.push({ index: document.geometry.indexOf(shape), shape, paths });
    shapeIds.add(shape.id);
    const loops = closedLoops([{ ...shape, paths }]);
    for (const [operationId, { tabs }] of drawingMarkers(document, id)) {
      if (!tabs.some(Boolean)) continue;
      const operation = document.operations.find((candidate) => candidate.id === operationId);
      const positions =
        operation?.type === "profile" ? (operation.params.tabs?.positions ?? []) : [];
      const mine = owned.get(operationId) ?? positions.map(() => false);
      const off = gone.get(operationId) ?? positions.map(() => false);
      tabs.forEach((own, i) => {
        if (!own) return;
        mine[i] = true;
        const at = move(positions[i] as Point);
        if ((nearestOnLoops(loops, at)?.distance ?? Infinity) > TAB_ON_OUTLINE) off[i] = true;
      });
      owned.set(operationId, mine);
      gone.set(operationId, off);
    }
  }
  let removedTabs = 0;
  for (const flags of gone.values()) removedTabs += flags.filter(Boolean).length;
  return {
    removedTabs,
    apply: (draft) => {
      // By index: finding them through the draft would read every shape. New
      // objects, as the draft's geometry may hold the frozen shapes themselves.
      for (const { index, shape, paths } of changed) draft.geometry[index] = { ...shape, paths };
      const selections = draft.drawings.flatMap((d) => d.pattern?.boundary ?? []);
      for (const own of selections) {
        if (shapeIds.has(own.shapeId) && own.paths !== null) own.paths = null;
      }
      for (const operation of draft.operations) {
        for (const own of operation.targets) {
          if (shapeIds.has(own.shapeId) && own.paths !== null) own.paths = null;
        }
        const mine = owned.get(operation.id);
        const tabs = operation.type === "profile" ? operation.params.tabs : null;
        if (!mine || !tabs) continue;
        // Both flag lists index the tabs as they were: map, then filter, once.
        const flags = gone.get(operation.id) ?? [];
        tabs.positions = tabs.positions
          .map((position, i) => (mine[i] ? move(position) : position))
          .filter((_, i) => !flags[i]);
      }
    },
  };
}

/**
 * The patterns bounded by `shapeIds`, which changed to `geometry`, with their
 * settings once their placement is mapped by `move` (none: it stays): each
 * generated again into `derived`, cells keeping their size; or, during a
 * gesture, marked to be generated when it commits (`stalePatterns`), its cells
 * mapped by `move` into `derived` meanwhile. A pattern that can't be generated
 * keeps its cells, or refuses with `refuse` set, returning the reason instead.
 */
function followPatterns(
  store: DocumentStore,
  document: ProjectDocument,
  geometry: readonly Shape[],
  shapeIds: ReadonlySet<string>,
  derived: Map<string, Path[]>,
  {
    move = null,
    exact = false,
    renumbered = false,
    refuse = false,
  }: {
    move?: ((point: Point) => Point) | null;
    /** Whether the caller maps their cells exactly with `move`, so none is generated. */
    exact?: boolean;
    /** Whether the boundary's paths are numbered afresh, as a text item's are. */
    renumbered?: boolean;
    refuse?: boolean;
  },
): Map<string, PatternSettings> {
  const deferred = store.getState().inTransaction;
  const followers = new Map<string, PatternSettings>();
  for (const drawing of document.drawings) {
    const pattern = drawing.pattern;
    if (!pattern?.boundary.some(({ shapeId }) => shapeIds.has(shapeId))) continue;
    // Selections of paths whose numbers are about to change take the whole shape.
    const boundary = pattern.boundary.map((own) =>
      renumbered && shapeIds.has(own.shapeId) ? { ...own, paths: null } : own,
    );
    const placement = move ? mapPlacement(pattern.placement, move).placement : pattern.placement;
    const settings: PatternSettings = { ...pattern, placement, boundary };
    followers.set(drawing.id, settings);
    if (exact) continue;
    const [cells] = drawingShapes(document.geometry, drawing.id);
    if (deferred) {
      stalePatterns.add(settings);
      if (move && cells) derived.set(drawing.id, mapShapes([cells], move, false)[0]?.paths ?? []);
      continue;
    }
    const generated = generatePattern(geometry, settings);
    if (generated.ok) derived.set(drawing.id, generated.paths);
    else if (refuse) throw new RefusedPattern(generated.error);
  }
  return followers;
}

/** Thrown inside an action by `followPatterns` to refuse it, changing nothing. */
class RefusedPattern extends Error {
  constructor(readonly error: Message) {
    super(error.code);
  }
}

/**
 * Generates once, as part of the gesture closing, the patterns whose cells
 * were only mapped during it (`stalePatterns`). The document store calls it
 * before committing a transaction, so each stays one undo step.
 */
export function settlePatterns(state: DocumentState) {
  const { document } = state;
  const stale = document.drawings.filter(({ pattern }) => pattern && stalePatterns.has(pattern));
  if (stale.length === 0) return;
  const derived = new Map<string, Path[]>();
  // shortcut: one generation on the main thread as a gesture ends; move it to the worker if a dense pattern's drop janks.
  for (const { id, pattern } of stale) {
    const generated = pattern ? generatePattern(document.geometry, pattern) : null;
    if (generated?.ok) derived.set(id, generated.paths);
  }
  const change = derivedPathsChange(document, derived);
  state.change("settlePatterns", (draft) => {
    for (const drawing of draft.drawings) {
      // A fresh copy, generated: no longer stale.
      if (derived.has(drawing.id) && drawing.pattern) drawing.pattern = { ...drawing.pattern };
    }
    change.apply(draft);
  });
}

/** The shapes of drawing `id`. */
export function drawingShapes(geometry: Shape[], id: string): Shape[] {
  return geometry.filter((shape) => shape.drawingId === id);
}

/** The bounding box of drawing `id`, or `null` if it has no shapes. */
export function drawingBounds(geometry: Shape[], id: string): Rect | null {
  return shapesBounds(drawingShapes(geometry, id));
}

/**
 * The operations that machine only drawing `id`, which go with it; a drill
 * with placed holes (#429) stays.
 */
export function drawingOperations(document: ProjectDocument, id: string): Operation[] {
  const shapeIds = new Set(drawingShapes(document.geometry, id).map((shape) => shape.id));
  return document.operations.filter(
    (operation) =>
      operation.targets.length > 0 &&
      operation.targets.every(({ shapeId }) => shapeIds.has(shapeId)) &&
      !hasPlacedHoles(operation),
  );
}

/**
 * A profile's or engraving's params, with the start points either of them
 * has: one assignment serves both, as moving, copying and filtering keep
 * each start point in its own form.
 */
export type StartPointParams = { startPoints: (Point | ProfileStartPoint)[] };

/**
 * `startPoints` of a profile or engraving moved by `move`, a profile's plunge
 * points (#427) with them; only those `own` marks when given.
 */
export function moveStartPoints<T extends Point | ProfileStartPoint>(
  startPoints: T[],
  move: (point: Point) => Point,
  own?: boolean[],
): T[] {
  return startPoints.map((startPoint, i) => {
    if (own && !own[i]) return startPoint;
    if (Array.isArray(startPoint)) return move(startPoint) as T;
    const { start, plunge } = startPoint as ProfileStartPoint;
    return { start: move(start), plunge: plunge && move(plunge) } as T;
  });
}

/**
 * Which of an operation's tab positions, start points (#426), excluded
 * corner overcuts (#428) and placed holes (#429) belong to a drawing.
 */
type OwnMarkers = {
  tabs: boolean[];
  startPoints: boolean[];
  overcuts: boolean[];
  holes: boolean[];
};

/**
 * How far off a drawing's snap targets and edges a placed hole still lies on
 * it: holes are snapped onto them exactly, but a scaled arc flattens anew.
 */
const HOLE_ON_DRAWING = 0.05;

/**
 * Which tab positions, start points and excluded overcuts of each profile or
 * engraving targeting drawing `id` belong to it, by operation id: those
 * nearer its paths than the operation's other targets' (ADR-0055), closed
 * paths for tabs and overcuts and any path for start points. They are placed on the paths, but a
 * tolerance can't tell after a scale moves them off the new flattening; a
 * tie, coincident shapes of two drawings, stays with the other drawing.
 */
function drawingMarkers(
  document: ProjectDocument,
  id: string,
  /** Whether to find the placed holes on it too, which only moving or copying it needs. */
  withHoles = false,
): Map<string, OwnMarkers> {
  const shapes = new Map(document.geometry.map((shape) => [shape.id, shape]));
  const markers = new Map<string, OwnMarkers>();
  const allPaths = (of: Shape[]) => startPointPaths(of, "on").map(({ points }) => points);
  // Built on the first drill with placed holes: most projects have none.
  let ownHoles: ((point: Point) => boolean) | null = null;
  for (const operation of document.operations) {
    if (withHoles && operation.type === "drill" && operation.params.points.length > 0) {
      ownHoles ??= drawingHoles(document, id);
      const holes = operation.params.points.map(ownHoles);
      markers.set(operation.id, { tabs: [], startPoints: [], overcuts: [], holes });
      continue;
    }
    if (operation.type !== "profile" && operation.type !== "engrave") continue;
    // Only the paths it cuts: a marker on an uncut path of another drawing doesn't take it.
    const targeted = targetedShapes(shapes, operation.targets);
    const mine = targeted.filter((shape) => shape.drawingId === id);
    if (mine.length === 0) continue;
    const others = targeted.filter((shape) => shape.drawingId !== id);
    const own = (positions: Point[], lines: (of: Shape[]) => Point[][]) => {
      if (positions.length === 0) return [];
      const [near, far] = [lines(mine), lines(others)];
      return positions.map((position) => {
        const ours = nearestOnLoops(near, position);
        const theirs = nearestOnLoops(far, position);
        return ours !== null && (theirs === null || ours.distance < theirs.distance);
      });
    };
    const profile = operation.type === "profile" ? operation.params : null;
    markers.set(operation.id, {
      tabs: own(profile?.tabs?.positions ?? [], (of) => closedLoops(of)),
      startPoints: own(
        operation.type === "profile"
          ? operation.params.startPoints.map(({ start }) => start)
          : operation.params.startPoints,
        allPaths,
      ),
      overcuts: own(profile?.cornerOvercuts?.excluded ?? [], (of) => closedLoops(of)),
      holes: [],
    });
  }
  return markers;
}

/**
 * Whether a placed hole (#429) belongs to drawing `id`: within
 * `HOLE_ON_DRAWING` of one of its snap targets or edges (stock anchors
 * aside), and nearer them than any other drawing's. A hole placed elsewhere
 * belongs to none and stays put, like the zero. Other drawings are only
 * looked at for a hole on this one, and only near their boxes, so dragging a
 * drawing doesn't flatten the whole project on every move.
 */
function drawingHoles(document: ProjectDocument, id: string): (point: Point) => boolean {
  const drawings = new Map<string, Shape[]>();
  for (const shape of document.geometry) {
    const shapes = drawings.get(shape.drawingId);
    if (shapes) shapes.push(shape);
    else drawings.set(shape.drawingId, [shape]);
  }
  const lookups = new Map<string, { targets: SnapTarget[]; edges: SnapEdge[] }>();
  const near = (drawingId: string, point: Point): number => {
    const shapes = drawings.get(drawingId) ?? [];
    let lookup = lookups.get(drawingId);
    if (!lookup) {
      lookup = {
        targets: holeSnapTargets(document.stock, shapes).filter(
          ({ kind }) => kind !== "stock_anchor",
        ),
        edges: snapEdges(shapes),
      };
      lookups.set(drawingId, lookup);
    }
    const snap = nearestHoleSnap(lookup.targets, lookup.edges, point, HOLE_ON_DRAWING);
    return snap ? distance(snap.point, point) : Infinity;
  };
  const boxes = new Map(
    [...drawings].map(([drawingId, shapes]) => [drawingId, shapesBounds(shapes)]),
  );
  const nearBox = (drawingId: string, [x, y]: Point) => {
    const box = boxes.get(drawingId);
    const t = HOLE_ON_DRAWING;
    return (
      !!box &&
      x >= box.min[0] - t &&
      x <= box.max[0] + t &&
      y >= box.min[1] - t &&
      y <= box.max[1] + t
    );
  };
  return (point) => {
    if (!nearBox(id, point)) return false;
    const ours = near(id, point);
    if (ours > HOLE_ON_DRAWING) return false;
    for (const other of drawings.keys()) {
      if (other !== id && nearBox(other, point) && near(other, point) <= ours) return false;
    }
    return true;
  };
}

/**
 * Keeps a text item's or a pattern's placement on its shapes once `move` has
 * rewritten their points (ADR-0059, ADR-0087). Every change that moves all of
 * a text item's or a pattern's points calls it with the same move, in the
 * same undo step.
 */
export function moveSettingsWithShapes(drawing: Drawing, move: (point: Point) => Point) {
  if (drawing.text) drawing.text = mapText(drawing.text, move);
  if (drawing.pattern) {
    drawing.pattern = { ...drawing.pattern, ...mapPlacement(drawing.pattern.placement, move) };
  }
}

/** Whether a segment of `shapes` has no length, or an arc no radius (`segmentIssue`). */
function degenerate(shapes: Shape[]): boolean {
  return shapes.some(({ paths }) =>
    paths.some(({ start, segments }) =>
      segments.some((segment, i) => segmentIssue(segments[i - 1]?.to ?? start, segment) !== null),
    ),
  );
}

const TOO_SMALL: Message = { code: "workspace.drawingTooSmall" };

/**
 * A rewrite of a drawing's points: its shapes, and each of its tabs'
 * positions, and of its rotation if it turns or mirrors it.
 */
type Transform = {
  shapes: (shapes: Shape[]) => Shape[];
  point: (point: Point) => Point;
  rotation?: (degrees: number) => number;
  /** Whether it mirrors, which flips arcs' direction (`mapShapes`). */
  mirrored?: boolean;
};

/**
 * Rewrites drawing `id` with `transform`, as one undo step, and the profile
 * tabs lying on its paths and the placed holes on it with it (ADR-0055).
 * Refuses, changing nothing, a
 * result with a segment shrunk to nothing: the document would be invalid.
 */
function transformDrawing(
  store: DocumentStore,
  name: string,
  id: string,
  transform: Transform,
): ActionResult {
  const { document } = store.getState();
  const drawing = document.drawings.find((d) => d.id === id);
  if (drawing?.pattern) return transformPattern(store, name, drawing, drawing.pattern, transform);
  const shapes = drawingShapes(document.geometry, id);
  if (shapes.length === 0) return { ok: true };
  const rewritten = transform.shapes(shapes);
  if (degenerate(rewritten)) return { ok: false, error: TOO_SMALL };
  const byId = new Map(rewritten.map((shape) => [shape.id, shape]));
  // One assignment, not one per shape, as on import.
  const boundaries = document.geometry.map((shape) => byId.get(shape.id) ?? shape);

  // The patterns it bounds follow it (ADR-0087): moved, turned and mirrored
  // with it, or generated again inside it when it is scaled, keeping their
  // cells' size.
  const { scale } = mapPlacement(
    { position: [0, 0], rotation: 0, mirrored: false },
    transform.point,
  );
  const rigid = Math.abs(scale - 1) < 1e-9;
  const own = new Set(shapes.map((shape) => shape.id));
  const derived = new Map<string, Path[]>();
  let followers: Map<string, PatternSettings>;
  try {
    followers = followPatterns(store, document, boundaries, own, derived, {
      move: transform.point,
      exact: rigid,
      refuse: true,
    });
  } catch (error) {
    if (error instanceof RefusedPattern) return { ok: false, error: error.error };
    throw error;
  }
  // A move, turn or mirror carries their cells exactly, path numbers and all.
  const moved = [id];
  if (rigid) {
    for (const followerId of followers.keys()) {
      for (const cell of mapShapes(
        drawingShapes(document.geometry, followerId),
        transform.point,
        transform.mirrored ?? false,
      )) {
        byId.set(cell.id, cell);
      }
      moved.push(followerId);
    }
  }
  const geometry = document.geometry.map((shape) => byId.get(shape.id) ?? shape);
  const markers = moved.map((movedId) => drawingMarkers(document, movedId, true));
  const regenerated = [...derived.keys()].map((followerId) =>
    drawingMarkers(document, followerId, true),
  );
  const change = derivedPathsChange(document, derived, transform.point);
  store.getState().change(name, (draft) => {
    draft.geometry = geometry;
    for (const d of draft.drawings) {
      const settings = followers.get(d.id);
      if (d.id !== id && !settings) continue;
      if (d.id === id) moveSettingsWithShapes(d, transform.point);
      else if (settings) d.pattern = settings;
      if (transform.rotation) d.rotation = normalizeDegrees(transform.rotation(d.rotation));
    }
    for (const ofDrawing of markers) moveMarkers(draft, ofDrawing, transform.point, true);
    // Their tabs move, or go, with their new cells.
    for (const ofDrawing of regenerated) moveMarkers(draft, ofDrawing, transform.point, false);
    change.apply(draft);
  });
  return { ok: true };
}

/** Moves the markers in `markers` (`drawingMarkers`) with `point`, profile tabs only `withTabs`. */
function moveMarkers(
  draft: Draft<ProjectDocument>,
  markers: Map<string, OwnMarkers>,
  point: (point: Point) => Point,
  withTabs: boolean,
) {
  for (const operation of draft.operations) {
    const moved = markers.get(operation.id);
    const move = (positions: Point[], own: boolean[]) =>
      positions.forEach((position, i) => {
        if (own[i]) positions[i] = point(position);
      });
    if (moved && operation.type === "drill") move(operation.params.points, moved.holes);
    if (!moved || (operation.type !== "profile" && operation.type !== "engrave")) continue;
    if (withTabs && operation.type === "profile" && operation.params.tabs) {
      move(operation.params.tabs.positions, moved.tabs);
    }
    if (operation.type === "profile" && operation.params.cornerOvercuts) {
      move(operation.params.cornerOvercuts.excluded, moved.overcuts);
    }
    const params: StartPointParams = operation.params;
    params.startPoints = moveStartPoints(params.startPoints, point, moved.startPoints);
  }
}

/**
 * Transforms pattern `drawing` on its own (ADR-0087): its placement maps with
 * `transform`, a scale multiplying its cells' lengths but not its inset, and
 * its cells are generated again inside the same boundary, as one undo step,
 * or during a gesture mapped, and generated as it commits. Refuses, changing
 * nothing, cells smaller than the shortest length or none left inside.
 */
function transformPattern(
  store: DocumentStore,
  name: string,
  drawing: Drawing,
  pattern: PatternSettings,
  transform: Transform,
): ActionResult {
  const { document, inTransaction } = store.getState();
  const { placement, scale } = mapPlacement(pattern.placement, transform.point);
  const scaled = (length: number) => roundCoordinate(length * scale);
  const settings: PatternSettings = {
    ...pattern,
    placement,
    size: scaled(pattern.size),
    gap: scaled(pattern.gap),
    amplitude: scaled(pattern.amplitude),
    wavelength: scaled(pattern.wavelength),
  };
  if (Math.min(settings.size, settings.amplitude, settings.wavelength) < MIN_LENGTH) {
    return { ok: false, error: TOO_SMALL };
  }
  const [cells] = drawingShapes(document.geometry, drawing.id);
  let paths: Path[];
  if (inTransaction) {
    stalePatterns.add(settings);
    paths = cells
      ? (mapShapes([cells], transform.point, transform.mirrored ?? false)[0]?.paths ?? [])
      : [];
  } else {
    const generated = generatePattern(document.geometry, settings);
    if (!generated.ok) return generated;
    paths = generated.paths;
  }
  const markers = drawingMarkers(document, drawing.id, true);
  const change = derivedPathsChange(document, new Map([[drawing.id, paths]]), transform.point);
  store.getState().change(name, (draft) => {
    const d = draft.drawings.find(({ id }) => id === drawing.id);
    if (d) {
      d.pattern = settings;
      if (transform.rotation) d.rotation = normalizeDegrees(transform.rotation(d.rotation));
    }
    moveMarkers(draft, markers, transform.point, false);
    change.apply(draft);
  });
  return { ok: true };
}

/** Scales drawing `id` by `scale` about `from`, which lands on `to` (`scaleShapes`). */
function scaleDrawing(
  store: DocumentStore,
  name: string,
  id: string,
  scale: number,
  from: Point,
  to: Point,
): ActionResult {
  if (scale === 1 && from[0] === to[0] && from[1] === to[1]) return { ok: true };
  return transformDrawing(store, name, id, {
    shapes: (shapes) => scaleShapes(shapes, scale, from, to),
    point: (point) => scalePoint(point, scale, from, to),
  });
}

/** `degrees` as an angle from above -180 up to 180, as a drawing's rotation. */
export function normalizeDegrees(degrees: number): number {
  // + 0 turns -0, as from mirroring 0 or turning by -360, into 0.
  const turned = (degrees % 360) + 0;
  if (turned > 180) return turned - 360;
  return turned <= -180 ? turned + 360 : turned;
}

/**
 * Turns drawing `id` with `move` about the centre of its box, then moves it
 * back so its point at the zero's anchor (`modelAnchor`) stays where it was,
 * and updates its rotation with `rotation`. A `mirrored` move flips arcs'
 * direction (`mapShapes`).
 */
function orientDrawing(
  store: DocumentStore,
  name: string,
  id: string,
  move: (point: Point, centre: Point) => Point,
  rotation: (degrees: number) => number,
  mirrored: boolean,
): ActionResult {
  const { document } = store.getState();
  const shapes = drawingShapes(document.geometry, id);
  const before = shapesBounds(shapes);
  if (!before) return { ok: true };
  const centre = anchorPoint(before, "center");
  const turned = mapShapes(shapes, (point) => move(point, centre), mirrored);
  const after = shapesBounds(turned);
  if (!after) return { ok: true };
  const anchor = modelAnchor(document.stock);
  const [x, y] = anchorPoint(before, anchor);
  const [ax, ay] = anchorPoint(after, anchor);
  const back: Point = [x - ax, y - ay];
  return transformDrawing(store, name, id, {
    shapes: () => translateShapes(turned, back),
    point: (point) => translatePoint(move(point, centre), back),
    rotation,
    mirrored,
  });
}

/**
 * Mirrors drawing `id` left to right (`"x"`) or top to bottom (`"y"`), in
 * place (PRD-0009 D6), negating its rotation: a turn then a mirror is the
 * mirror then the opposite turn.
 */
export function mirrorDrawing(store: DocumentStore, id: string, axis: "x" | "y"): ActionResult {
  return orientDrawing(
    store,
    `mirrorDrawing.${axis}`,
    id,
    (point, centre) => mirrorPoint(point, axis, centre),
    (rotation) => -rotation,
    true,
  );
}

/**
 * Turns drawing `id` by `degrees`, counter-clockwise for positive ones,
 * keeping its point at the zero's anchor in place (PRD-0009 D7), and adds
 * them to its rotation.
 */
export function rotateDrawing(store: DocumentStore, id: string, degrees: number): ActionResult {
  return turnDrawing(store, id, degrees, (rotation) => rotation + degrees);
}

/** Turns drawing `id` until its rotation is `degrees` (ADR-0066). */
export function setDrawingRotation(
  store: DocumentStore,
  id: string,
  degrees: number,
): ActionResult {
  const drawing = store.getState().document.drawings.find((d) => d.id === id);
  if (!drawing) return { ok: true };
  const target = normalizeDegrees(degrees);
  // The target itself, not the sum, so the field shows what was typed.
  return turnDrawing(store, id, target - drawing.rotation, () => target);
}

/** Turns drawing `id` by `degrees`, setting its rotation with `rotation`. */
function turnDrawing(
  store: DocumentStore,
  id: string,
  degrees: number,
  rotation: (degrees: number) => number,
): ActionResult {
  if (degrees % 360 === 0) return { ok: true };
  return orientDrawing(
    store,
    "rotateDrawing",
    id,
    (point, centre) => rotatePoint(point, degrees, centre),
    rotation,
    false,
  );
}

/** Moves drawing `id` by `offset` millimetres, with the tabs on its paths (PRD-0009 D5). */
export function moveDrawing(store: DocumentStore, id: string, offset: Point) {
  if (offset[0] === 0 && offset[1] === 0) return;
  transformDrawing(store, "moveDrawing", id, {
    shapes: (shapes) => translateShapes(shapes, offset),
    point: (point) => translatePoint(point, offset),
  });
}

/**
 * Where drawing `bounds` sit relative to the XY zero: their point at the
 * zero's anchor (`modelAnchor`), in millimetres, as a model's position.
 */
export function drawingOffset(stock: Stock, bounds: Rect): Point {
  const [x, y] = anchorPoint(bounds, modelAnchor(stock));
  const [zx, zy] = xyOriginPosition(stock);
  return [x - zx, y - zy];
}

/**
 * Moves drawing `id` along one axis so that its anchor point is `value`
 * millimetres from the XY zero (`drawingOffset`).
 */
export function setDrawingOffset(store: DocumentStore, id: string, axis: "x" | "y", value: number) {
  const { document } = store.getState();
  const bounds = drawingBounds(document.geometry, id);
  if (!bounds) return;
  const i = axis === "x" ? 0 : 1;
  const offset: Point = [0, 0];
  offset[i] = value - (drawingOffset(document.stock, bounds)[i] as number);
  moveDrawing(store, id, offset);
}

/** Moves drawing `id` so that the centre of its box is the stock's centre, whatever the zero. */
export function centerDrawingOnStock(store: DocumentStore, id: string) {
  const { document } = store.getState();
  const bounds = drawingBounds(document.geometry, id);
  if (!bounds) return;
  const [cx, cy] = anchorPoint(bounds, "center");
  const offset: Point = [document.stock.width / 2 - cx, document.stock.height / 2 - cy];
  // Already centred but for float noise: no undo step.
  if (Math.abs(offset[0]) < GEOMETRY_TOLERANCE && Math.abs(offset[1]) < GEOMETRY_TOLERANCE) return;
  moveDrawing(store, id, offset);
}

/**
 * Sets drawing `id`'s width or height to `value` millimetres, scaling it the
 * same both ways so it keeps its proportions, about its point at the zero's
 * anchor (`modelAnchor`), which stays put.
 */
export function setDrawingSize(
  store: DocumentStore,
  id: string,
  axis: "width" | "height",
  value: number,
): ActionResult {
  const { document } = store.getState();
  const bounds = drawingBounds(document.geometry, id);
  if (!bounds) return { ok: true };
  const i = axis === "width" ? 0 : 1;
  const extent = (bounds.max[i] as number) - (bounds.min[i] as number);
  if (extent <= 0) return { ok: true };
  const anchor = anchorPoint(bounds, modelAnchor(document.stock));
  return scaleDrawing(store, `setDrawing.${axis}`, id, value / extent, anchor, anchor);
}

/**
 * Scales drawing `id` to fit inside the stock less its border, aligned to it
 * at the zero's anchor (`drawingFit`).
 */
export function fitDrawingToStock(store: DocumentStore, id: string): ActionResult {
  const { document } = store.getState();
  const drawing = document.drawings.find((d) => d.id === id);
  const bounds = drawingBounds(document.geometry, id);
  if (!drawing || !bounds) return { ok: true };
  const fit = drawingFit(bounds, document.stock, modelAnchor(document.stock), drawing.border);
  if (!fit) return { ok: true };
  return scaleDrawing(store, "fitDrawing", id, fit.scale, fit.from, fit.to);
}

/** Sets the border *Fit to stock* leaves around drawing `id`, without fitting it. */
export function setDrawingBorder(store: DocumentStore, id: string, border: number) {
  store.getState().change("setDrawing.border", (draft) => {
    const drawing = draft.drawings.find((d) => d.id === id);
    if (drawing && drawing.border !== border) drawing.border = border;
  });
}

/**
 * Turns text item `id` into a plain drawing (PRD-0010 T8, ADR-0059), as one
 * undo step: it keeps its outlines as its shape, so the operations machining
 * it still do, and is transformed like any drawing, but no longer edited as
 * text.
 */
export function convertTextToDrawing(store: DocumentStore, id: string) {
  store.getState().change("convertText", (draft) => {
    const drawing = draft.drawings.find((d) => d.id === id);
    if (drawing?.text) delete drawing.text;
  });
}

/**
 * Hides or shows, or locks or unlocks, the drawing, shape or model `id`
 * (ADR-0080), as one undo step. A drawing's flag covers its shapes; a shape's
 * own counts only inside a shown, unlocked drawing.
 */
export function setObjectFlag(
  store: DocumentStore,
  id: string,
  flag: "hidden" | "locked",
  on: boolean,
) {
  store.getState().change(`setObject.${flag}`, (draft) => {
    const object =
      draft.drawings.find((drawing) => drawing.id === id) ??
      draft.geometry.find((shape) => shape.id === id) ??
      draft.models.find((model) => model.id === id);
    if (!object || (object[flag] === true) === on) return;
    if (on) object[flag] = true;
    else delete object[flag];
  });
}

/**
 * `shapes` as copies in drawing `drawingId`, each with its id in `ids` or a
 * new one. A copy starts shown and unlocked (ADR-0080).
 */
export function copyShapes(
  shapes: Shape[],
  drawingId: string,
  ids: ReadonlyMap<string, string> = new Map(),
): Shape[] {
  return shapes.map(({ hidden: _, locked: __, ...shape }) => ({
    ...shape,
    id: ids.get(shape.id) ?? crypto.randomUUID(),
    drawingId,
  }));
}

/** The gap between a drawing and its duplicate, in millimetres. */
export const DUPLICATE_GAP = 10;

/**
 * Copies drawing `id` to the right of its box, `DUPLICATE_GAP` away, as one
 * undo step (PRD-0009 D8): every operation targeting its shapes targets the
 * copy's too, with the same paths, and the tabs on its paths and the placed
 * holes on it are copied with it. The copy may run off the stock. Returns
 * the copy's id, or `null` for an unknown drawing.
 */
export function duplicateDrawing(store: DocumentStore, id: string): string | null {
  const { document } = store.getState();
  const drawing = document.drawings.find((d) => d.id === id);
  const shapes = drawingShapes(document.geometry, id);
  const bounds = shapesBounds(shapes);
  if (!drawing || !bounds) return null;
  const offset: Point = [bounds.max[0] - bounds.min[0] + DUPLICATE_GAP, 0];
  const copyId = crypto.randomUUID();
  const ids = new Map(shapes.map((shape) => [shape.id, crypto.randomUUID()]));
  const copies = copyShapes(translateShapes(shapes, offset), copyId, ids);
  // One assignment, not a spread push, as on import.
  const geometry = document.geometry.concat(copies);
  const markers = drawingMarkers(document, id, true);
  store.getState().change("duplicateDrawing", (draft) => {
    // A pattern's copy is a plain drawing: it would fill the same boundary (ADR-0087).
    const { hidden: _, locked: __, pattern: ___, ...original } = drawing;
    const copy = { ...original, id: copyId };
    moveSettingsWithShapes(copy, (point) => translatePoint(point, offset));
    draft.drawings.push(copy);
    draft.geometry = geometry;
    for (const operation of draft.operations) {
      const extra = operation.targets.flatMap(({ shapeId, paths }) => {
        const copy = ids.get(shapeId);
        // A fresh array: the draft's may not sit in two places.
        return copy ? [{ shapeId: copy, paths: paths && [...paths] }] : [];
      });
      // One assignment, not a spread push: a drawing may hold more shapes than a call takes arguments.
      if (extra.length > 0) operation.targets = operation.targets.concat(extra);
      const own = markers.get(operation.id);
      // One assignment, as for targets: a large drawing has more tabs than a call takes arguments.
      const copied = (positions: Point[], mine: boolean[]) =>
        positions.concat(
          positions.filter((_, i) => mine[i]).map((position) => translatePoint(position, offset)),
        );
      if (own?.holes.some(Boolean) && operation.type === "drill") {
        operation.params.points = copied(operation.params.points, own.holes);
      }
      if (!own || (operation.type !== "profile" && operation.type !== "engrave")) continue;
      if (operation.type === "profile" && operation.params.tabs) {
        operation.params.tabs.positions = copied(operation.params.tabs.positions, own.tabs);
      }
      const overcuts = operation.type === "profile" ? operation.params.cornerOvercuts : null;
      if (overcuts && own.overcuts.some(Boolean)) {
        overcuts.excluded = copied(overcuts.excluded, own.overcuts);
      }
      if (own.startPoints.some(Boolean)) {
        const params: StartPointParams = operation.params;
        const mine = params.startPoints.filter((_, i) => own.startPoints[i]);
        params.startPoints = params.startPoints.concat(
          moveStartPoints(mine, (point) => translatePoint(point, offset)),
        );
      }
    }
  });
  return copyId;
}

/**
 * Removes a drawing, its shapes and the operation targets that point at
 * them, as one undo step. An operation left with no targets goes too, as a
 * model's operations go with it, and so do the tabs lying on its paths
 * (ADR-0055).
 */
export function removeDrawing(store: DocumentStore, id: string) {
  const owned = drawingMarkers(store.getState().document, id);
  store.getState().change("removeDrawing", (draft) => {
    const index = draft.drawings.findIndex((drawing) => drawing.id === id);
    if (index === -1) return;
    draft.drawings.splice(index, 1);
    const removed = new Set(
      draft.geometry.filter((shape) => shape.drawingId === id).map((shape) => shape.id),
    );
    draft.geometry = draft.geometry.filter((shape) => !removed.has(shape.id));
    // A pattern it bounded becomes a plain drawing with the cells it had (ADR-0087, P8).
    for (const drawing of draft.drawings) {
      if (drawing.pattern?.boundary.some(({ shapeId }) => removed.has(shapeId))) {
        delete drawing.pattern;
      }
    }
    draft.operations = draft.operations.filter((operation) => {
      const targets = operation.targets.filter(({ shapeId }) => !removed.has(shapeId));
      if (targets.length === operation.targets.length) return true;
      operation.targets = targets;
      const gone = owned.get(operation.id);
      const tabs = operation.type === "profile" ? operation.params.tabs : null;
      if (gone && tabs) tabs.positions = tabs.positions.filter((_, i) => !gone.tabs[i]);
      const overcuts = operation.type === "profile" ? operation.params.cornerOvercuts : null;
      if (gone && overcuts) {
        overcuts.excluded = overcuts.excluded.filter((_, i) => !gone.overcuts[i]);
      }
      if (
        gone?.startPoints.some(Boolean) &&
        (operation.type === "profile" || operation.type === "engrave")
      ) {
        const params: StartPointParams = operation.params;
        params.startPoints = params.startPoints.filter((_, i) => !gone.startPoints[i]);
      }
      return targets.length > 0 || hasPlacedHoles(operation);
    });
  });
}
