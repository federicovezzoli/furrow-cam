import type { StockAnchor } from "@furrow/document";

/** The 9 stock anchors as seen in the top view: the top row first, left to right (PRD-0002 Z2). */
export const ANCHOR_GRID = [
  ["top_left", "top_center", "top_right"],
  ["middle_left", "center", "middle_right"],
  ["bottom_left", "bottom_center", "bottom_right"],
] as const satisfies readonly (readonly StockAnchor[])[];

const MOVES: Record<string, [row: number, column: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/**
 * The anchor an arrow key moves to in the grid, stopping at its edges, or
 * `null` for any other key.
 */
export function anchorInDirection(anchor: StockAnchor, key: string): StockAnchor | null {
  const move = MOVES[key];
  if (!move) return null;
  const row = ANCHOR_GRID.findIndex((cells) => (cells as readonly StockAnchor[]).includes(anchor));
  const column = (ANCHOR_GRID[row] as readonly StockAnchor[]).indexOf(anchor);
  const clamp = (i: number) => Math.min(2, Math.max(0, i));
  return ANCHOR_GRID[clamp(row + move[0])][clamp(column + move[1])];
}
