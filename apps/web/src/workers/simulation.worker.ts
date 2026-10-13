import { heightmapBuffers, heightmapGrid, simulateCuts, smallestDiameter } from "@furrow/cam-core";
import type { SimulationRequest, SimulationResponse } from "@/stores/simulation-scheduler";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<SimulationRequest>) => void;
  postMessage: (response: SimulationResponse, transfer?: Transferable[]) => void;
};

/** Simulates material removal off the main thread (ADR-0004, ADR-0019). */
scope.onmessage = ({ data: { key, input } }) => {
  try {
    const { stock, cuts, maxCells } = input;
    const grid = heightmapGrid(stock, smallestDiameter(cuts), maxCells);
    const heightmap = simulateCuts(stock, cuts, grid);
    scope.postMessage({ key, heightmap }, heightmapBuffers(heightmap));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ key, error: message });
  }
};
