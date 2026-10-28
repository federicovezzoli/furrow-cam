import {
  flipHeightmap,
  type HeightmapGrid,
  heightmapBuffers,
  heightmapGrid,
  joinSides,
  simulateCuts,
  smallestCutWidth,
} from "@furrow/cam-core";
import { TEXTURE_WIDTH } from "../lib/simulation-mesh";
import type { SimulationRequest, SimulationResponse } from "../stores/simulation-scheduler";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<SimulationRequest>) => void;
  postMessage: (response: SimulationResponse, transfer?: Transferable[]) => void;
};

/** The top side's flipped heightmap last simulated for the bottom side, kept while its cuts and grid stay the same. */
let flippedTop: { key: string; grid: HeightmapGrid; heights: Float32Array } | null = null;

/** Simulates material removal off the main thread (ADR-0004, ADR-0019). */
scope.onmessage = ({ data: { key, input } }) => {
  try {
    const { stock, cuts, before, maxCells } = input;
    const all = before ? [...before.cuts, ...cuts] : cuts;
    const grid = heightmapGrid(stock, smallestCutWidth(all), maxCells);
    // Padded to whole texture rows, so the viewport uploads it without a copy.
    const heightmap = simulateCuts(stock, cuts, grid, TEXTURE_WIDTH);
    // The bottom side's stock is cut through where the top side's cuts meet its own.
    if (before) {
      if (!flippedTop || flippedTop.key !== before.key || !sameGrid(flippedTop.grid, grid)) {
        const heights = flipHeightmap(simulateCuts(stock, before.cuts, grid), before.axis);
        flippedTop = { key: before.key, grid, heights };
      }
      joinSides(heightmap.heights, flippedTop.heights, stock.thickness);
    }
    scope.postMessage({ key, heightmap, stock }, heightmapBuffers(heightmap));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ key, error: message });
  }
};

/** The stock is in the key, so the cell counts fix the cells' size too. */
function sameGrid(a: HeightmapGrid, b: HeightmapGrid) {
  return a.columns === b.columns && a.rows === b.rows;
}
