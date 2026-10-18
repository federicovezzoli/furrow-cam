import type { StockAnchor } from "@furrow/document";

export const ANCHOR_LABELS: Record<StockAnchor, string> = {
  top_left: "Top left",
  top_center: "Top centre",
  top_right: "Top right",
  middle_left: "Middle left",
  center: "Centre",
  middle_right: "Middle right",
  bottom_left: "Bottom left",
  bottom_center: "Bottom centre",
  bottom_right: "Bottom right",
};

/** The 9 stock anchors as seen in the top view: the top row first, left to right (PRD-0002 Z2). */
export const ANCHOR_GRID = [
  ["top_left", "top_center", "top_right"],
  ["middle_left", "center", "middle_right"],
  ["bottom_left", "bottom_center", "bottom_right"],
] as const satisfies readonly (readonly StockAnchor[])[];

/** A choice in the zero picker: an anchor, or the custom zero below the grid. */
export type ZeroChoice = StockAnchor | "custom";

const MOVES = new Map<string, [row: number, column: number]>([
  ["ArrowUp", [-1, 0]],
  ["ArrowDown", [1, 0]],
  ["ArrowLeft", [0, -1]],
  ["ArrowRight", [0, 1]],
]);

/**
 * Where an arrow key moves in the zero picker, or `null` for any other key.
 * Moves stop at the grid's edges, except that Custom sits after it: down from
 * the bottom row or right from the bottom-right corner reaches Custom, and up
 * or left from Custom goes back to the bottom-right corner.
 */
export function zeroChoiceInDirection(choice: ZeroChoice, key: string): ZeroChoice | null {
  const move = MOVES.get(key);
  if (!move) return null;
  if (choice === "custom") return move[0] < 0 || move[1] < 0 ? "bottom_right" : "custom";
  const row = ANCHOR_GRID.findIndex((cells) => (cells as readonly StockAnchor[]).includes(choice));
  if (row === -1) return null;
  const column = (ANCHOR_GRID[row] as readonly StockAnchor[]).indexOf(choice);
  const last = ANCHOR_GRID.length - 1;
  if (row === last && (move[0] > 0 || (column === last && move[1] > 0))) return "custom";
  const clamp = (i: number) => Math.min(last, Math.max(0, i));
  return ANCHOR_GRID[clamp(row + move[0])]?.[clamp(column + move[1])] ?? null;
}
