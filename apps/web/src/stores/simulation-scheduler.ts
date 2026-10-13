import type { Heightmap, SimulationCut } from "@furrow/cam-core";
import type { ProjectDocument, Stock } from "@furrow/document";
import type { DocumentStore } from "./document-store";
import type { ToolpathState, ToolpathStore } from "./toolpath-store";

/** Everything the simulation depends on, posted to its worker. */
export type SimulationInput = {
  stock: Pick<Stock, "width" | "height" | "thickness">;
  cuts: SimulationCut[];
  /** Most cells the heightmap may have, so the device can draw it. */
  maxCells: number;
};

export type SimulationRequest = { key: string; input: SimulationInput };

export type SimulationResponse = { key: string } & ({ heightmap: Heightmap } | { error: string });

/**
 * The simulation of the enabled operations' toolpaths, or `null` while any of
 * them is still computing: a stock with only some of its cuts would flash on
 * every edit. Operations whose toolpath failed are left out, and hidden
 * toolpaths still cut. Rapids are simulated too: one that runs through the
 * stock would cut it. `key` changes exactly when the result may, so an
 * unchanged key needs no new simulation.
 */
export function simulationRequest(
  document: ProjectDocument,
  entries: ToolpathState["entries"],
  maxCells: number,
): SimulationRequest | null {
  const { width, height, thickness } = document.stock;
  const cuts: SimulationCut[] = [];
  const hashes: string[] = [];
  for (const operation of document.operations) {
    if (!operation.enabled) continue;
    const entry = entries[operation.id];
    if (!entry || entry.status === "computing") return null;
    if (entry.status === "error") continue;
    const { type, diameter, vAngle, tipDiameter } = operation.tool;
    const tool = { type, diameter, vAngle, tipDiameter };
    cuts.push({ tool, segments: entry.lines.feeds }, { tool, segments: entry.lines.rapids });
    hashes.push(entry.inputHash);
  }
  return {
    key: JSON.stringify([width, height, thickness, hashes]),
    input: { stock: { width, height, thickness }, cuts, maxCells },
  };
}

/**
 * Keeps a simulation in step with the toolpaths: whenever they are all
 * computed and differ from the last simulated ones, it sends a request to the
 * worker through `post`; `receive` hands the worker's latest response to
 * `onResult`. One request at a time, like the toolpaths: changes made while
 * the worker simulates wait, and only the latest is sent once it answers.
 * `stop` stops listening; `fail` gives up on the request in flight, e.g. when
 * the worker crashed and was replaced.
 */
export function scheduleSimulation(
  documents: DocumentStore,
  toolpaths: ToolpathStore,
  post: (request: SimulationRequest) => void,
  onResult: (response: SimulationResponse) => void,
  maxCells: number,
) {
  let sentKey: string | null = null;
  let inFlight = false;
  let waiting: SimulationRequest | null = null;

  function send(request: SimulationRequest) {
    sentKey = request.key;
    inFlight = true;
    post(request);
  }

  function update() {
    const { document } = documents.getState();
    const request = simulationRequest(document, toolpaths.getState().entries, maxCells);
    if (!request) return;
    if (inFlight) {
      waiting = request.key === sentKey ? null : request;
      return;
    }
    if (request.key !== sentKey) send(request);
  }

  update();
  const stopDocuments = documents.subscribe((state, previous) => {
    if (state.document.stock !== previous.document.stock) update();
  });
  const stopToolpaths = toolpaths.subscribe((state, previous) => {
    if (state.entries !== previous.entries) update();
  });

  return {
    stop() {
      stopDocuments();
      stopToolpaths();
    },
    receive(response: SimulationResponse) {
      inFlight = false;
      onResult(response);
      const next = waiting;
      waiting = null;
      if (next) send(next);
    },
    fail(error: string) {
      if (sentKey !== null) onResult({ key: sentKey, error });
      inFlight = false;
      waiting = null;
      /** Simulated again once the toolpaths or the stock change. */
    },
  };
}
