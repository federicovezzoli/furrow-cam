import {
  flipHeightmap,
  heightmapBuffers,
  heightmapGrid,
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

/** Simulates material removal off the main thread (ADR-0004, ADR-0019). */
scope.onmessage = ({ data: { key, input } }) => {
  try {
    const { stock, cuts, before, maxCells } = input;
    const all = before ? [...before.cuts, ...cuts] : cuts;
    const grid = heightmapGrid(stock, smallestCutWidth(all), maxCells);
    // The bottom side's cuts start from the stock the top side's leave, turned over.
    const start =
      before && flipHeightmap(simulateCuts(stock, before.cuts, grid), before.axis, stock.thickness);
    // Padded to whole texture rows, so the viewport uploads it without a copy.
    const heightmap = simulateCuts(stock, cuts, grid, TEXTURE_WIDTH, start);
    scope.postMessage({ key, heightmap, stock }, heightmapBuffers(heightmap));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ key, error: message });
  }
};
