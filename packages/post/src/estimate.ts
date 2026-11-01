import type { Toolpath, ToolpathMove, Vec3 } from "@furrow/cam-core";
import { type Machine, machineSpinUpDelay } from "@furrow/document";
import { limitFeed } from "./machine-limits";

/** GRBL's and FluidNC's default junction deviation (`$11`), in mm. */
const JUNCTION_DEVIATION = 0.01;

/**
 * How long `toolpath` takes to cut on `machine`, in seconds (#420): each
 * move's length at the feed the program writes (`limitFeed`), rapids at the
 * machine's maximum rates, and a spin-up dwell for each tool it starts, its
 * clearing tool's included (ADR-0026), even where the program keeps the
 * spindle running from the operation before. With the machine's
 * accelerations, the moves go through a simplified GRBL planner (#437):
 * each one speeds up and slows down at the acceleration of the axes it
 * moves, through corners no faster than GRBL's junction deviation allows.
 * Without them, and always for tool changes, it is a lower bound.
 * Without a machine, rapids have no rate and count for nothing. The first
 * move of each list comes from wherever the tool was, so it isn't counted.
 */
export function estimateTime(toolpath: Toolpath, machine: Machine | null): number {
  return [toolpath.clearing ?? [], toolpath.moves].reduce(
    (total, moves) =>
      moves.length === 0 ? total : total + movesTime(moves, machine) + machineSpinUpDelay(machine),
    0,
  );
}

/**
 * GRBL's planner in two passes over the moves, from rest to rest: the
 * fastest each move may enter at, from its corner and both feeds, lowered
 * backwards so every move can still slow down for the next, then forwards
 * so it can speed up from the last. Linear in the moves. A missing
 * acceleration is infinite, which leaves each move its length at its feed.
 */
function movesTime(moves: ToolpathMove[], machine: Machine | null): number {
  // Per counted move: length (mm), feed and fastest entry (mm/s), acceleration (mm/s²).
  const lengths = new Float64Array(moves.length);
  const speeds = new Float64Array(moves.length);
  const entries = new Float64Array(moves.length);
  const accelerations = new Float64Array(moves.length);
  let count = 0;
  let from: Vec3 | null = null;
  let unit: Vec3 = [0, 0, 0];
  for (const move of moves) {
    if (from !== null && (move.kind === "feed" || machine !== null)) {
      const [dx, dy, dz] = [move.to[0] - from[0], move.to[1] - from[1], move.to[2] - from[2]];
      const length = Math.hypot(dx, dy, dz);
      if (length > 0) {
        // GRBL runs rapids at the machine's maximum rates.
        const feed = move.kind === "feed" ? move.feedRate : Infinity;
        const speed = limitFeed(from, move.to, feed, machine) / 60;
        const acceleration = limitAcceleration(Math.hypot(dx, dy), Math.abs(dz), length, machine);
        const next: Vec3 = [dx / length, dy / length, dz / length];
        if (count > 0) {
          const before = count - 1;
          const junction = junctionSpeed(
            unit,
            next,
            Math.min(acceleration, accelerations[before] as number),
          );
          entries[count] = Math.min(junction, speed, speeds[before] as number);
        }
        lengths[count] = length;
        speeds[count] = speed;
        accelerations[count] = acceleration;
        unit = next;
        count++;
      }
    }
    from = move.to;
  }

  for (let i = count - 1, exit = 0; i >= 0; i--) {
    const reach = Math.sqrt(exit ** 2 + 2 * (accelerations[i] as number) * (lengths[i] as number));
    entries[i] = Math.min(entries[i] as number, reach);
    exit = entries[i] as number;
  }
  let seconds = 0;
  for (let i = 0; i < count; i++) {
    const [length, acceleration] = [lengths[i] as number, accelerations[i] as number];
    const entry = entries[i] as number;
    const reach = Math.sqrt(entry ** 2 + 2 * acceleration * length);
    const exit = i + 1 < count ? Math.min(entries[i + 1] as number, reach) : 0;
    if (i + 1 < count) entries[i + 1] = exit;
    seconds += moveTime(length, speeds[i] as number, acceleration, entry, exit);
  }
  return seconds;
}

/** The acceleration of a move `xy` long in XY and `z` in Z: neither axis may exceed its own. */
function limitAcceleration(xy: number, z: number, length: number, machine: Machine | null) {
  let limit = Infinity;
  if (machine?.accelerationXY != null && xy > 0) {
    limit = Math.min(limit, (machine.accelerationXY * length) / xy);
  }
  if (machine?.accelerationZ != null && z > 0) {
    limit = Math.min(limit, (machine.accelerationZ * length) / z);
  }
  return limit;
}

/** The fastest GRBL takes the corner between unit vectors `before` and `after`, in mm/s. */
function junctionSpeed(before: Vec3, after: Vec3, acceleration: number): number {
  const cos = -(before[0] * after[0] + before[1] * after[1] + before[2] * after[2]);
  if (cos > 0.999999) return 0; // A reversal.
  if (cos < -0.999999) return Infinity; // Straight on.
  const sinHalf = Math.sqrt(0.5 * (1 - cos));
  return Math.sqrt((acceleration * JUNCTION_DEVIATION * sinHalf) / (1 - sinHalf));
}

/** Seconds along a trapezoidal profile, or a triangular one if the move is too short for `speed`. */
function moveTime(
  length: number,
  speed: number,
  acceleration: number,
  entry: number,
  exit: number,
) {
  const up = (speed ** 2 - entry ** 2) / (2 * acceleration);
  const down = (speed ** 2 - exit ** 2) / (2 * acceleration);
  if (up + down <= length) {
    return (speed - entry + speed - exit) / acceleration + (length - up - down) / speed;
  }
  const peak = Math.sqrt(acceleration * length + (entry ** 2 + exit ** 2) / 2);
  return (peak - entry + peak - exit) / acceleration;
}

/** `seconds` in English, to the minute: "45 s", "12 min", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
