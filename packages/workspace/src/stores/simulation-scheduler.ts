import type { Heightmap, SimulationCut, ToolpathLines } from "@furrow/cam-core";
import { clearingTool, type ProjectDocument, type Stock, type Tool } from "@furrow/document";
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

/** A heightmap comes back with the stock it was simulated on, which may have changed since. */
export type SimulationResponse = { key: string } & (
  | { heightmap: Heightmap; stock: SimulationInput["stock"] }
  | { error: string }
);

/**
 * The simulation of the enabled operations' toolpaths, or `null` while any of
 * them is still computing: a stock with only some of its cuts would flash on
 * every edit. Clearing moves (ADR-0026) are cut with the clearing tool. Operations whose toolpath failed are left out, and hidden
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
    // shortcut: the simulation cuts from above only; the bottom side's starts
    // from the flipped top side's result with the side switch (#358).
    if (!operation.enabled || operation.stockSide === "bottom") continue;
    const entry = entries[operation.id];
    if (!entry || entry.status === "computing") return null;
    if (entry.status === "error") continue;
    const clearing = clearingTool(operation);
    if (clearing && entry.clearing) cuts.push(...lineCuts(clearing, entry.clearing));
    cuts.push(...lineCuts(operation.tool, entry.lines));
    hashes.push(entry.inputHash);
  }
  return {
    key: JSON.stringify([width, height, thickness, hashes]),
    input: { stock: { width, height, thickness }, cuts, maxCells },
  };
}

/** The cuts of `lines`, feeds and rapids alike, made with `tool`. */
function lineCuts({ type, diameter, vAngle, tipDiameter }: Tool, lines: ToolpathLines) {
  const tool = { type, diameter, vAngle, tipDiameter };
  return [
    { tool, segments: lines.feeds },
    { tool, segments: lines.rapids },
  ];
}

/**
 * Keeps a simulation in step with the toolpaths: whenever they are all
 * computed and differ from the last simulated ones, it sends a request to the
 * worker through `post`; `receive` hands the worker's latest response to
 * `onResult`. One request at a time, like the toolpaths: changes made while
 * the worker simulates wait, and only the latest is sent once it answers.
 * `stop` stops listening; `fail` reports the request in flight as failed,
 * e.g. when the worker crashed, and sends the one waiting, if any.
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
      // An idle worker lost nothing: the simulation showing is still good.
      if (!inFlight || sentKey === null) return;
      inFlight = false;
      onResult({ key: sentKey, error });
      // Without one waiting, it simulates again once the toolpaths or the stock change.
      const next = waiting;
      waiting = null;
      if (next) send(next);
    },
  };
}
