import type { Toolpath, ToolpathMove, Vec3 } from "@furrow/cam-core";
import { type Machine, machineSpinUpDelay } from "@furrow/document";
import { limitFeed } from "./machine-limits";

/**
 * How long `toolpath` takes to cut on `machine`, in seconds (#420): each
 * move's length at the feed the program writes (`limitFeed`), rapids at the
 * machine's maximum rates, and a spin-up dwell for each tool it starts, its
 * clearing tool's included (ADR-0026). Acceleration and tool changes are left
 * out, so it is a lower bound. Without a machine, rapids have no rate and
 * count for nothing. The first move of each list comes from wherever the tool
 * was, so it isn't counted.
 */
export function estimateTime(toolpath: Toolpath, machine: Machine | null): number {
  return [toolpath.clearing ?? [], toolpath.moves].reduce(
    (total, moves) =>
      moves.length === 0 ? total : total + movesTime(moves, machine) + machineSpinUpDelay(machine),
    0,
  );
}

function movesTime(moves: ToolpathMove[], machine: Machine | null): number {
  let seconds = 0;
  let from: Vec3 | null = null;
  for (const move of moves) {
    if (from !== null && (move.kind === "feed" || machine !== null)) {
      const length = Math.hypot(move.to[0] - from[0], move.to[1] - from[1], move.to[2] - from[2]);
      // GRBL runs rapids at the machine's maximum rates.
      const rate = limitFeed(
        from,
        move.to,
        move.kind === "feed" ? move.feedRate : Infinity,
        machine,
      );
      if (length > 0) seconds += (length / rate) * 60;
    }
    from = move.to;
  }
  return seconds;
}

/** `seconds` in English, to the minute: "45 s", "12 min", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
