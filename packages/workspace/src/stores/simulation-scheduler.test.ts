import type { ToolpathLines } from "@furrow/cam-core";
import { createProjectDocument, type ProjectDocument } from "@furrow/document";
import { drill, endMill, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import {
  type SimulationRequest,
  type SimulationResponse,
  scheduleSimulation,
  simulationRequest,
} from "./simulation-scheduler";
import { createToolpathStore, type ToolpathStore } from "./toolpath-store";

const PROFILE_ID = "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a";
const DRILL_ID = "11111111-2222-4333-8444-555555555555";
const MAX_CELLS = 2048 * 2048;

function documentWithOperations(): ProjectDocument {
  return {
    ...createProjectDocument(),
    operations: [
      {
        id: PROFILE_ID,
        name: "Outside",
        enabled: true,
        stockSide: "top",
        type: "profile",
        targets: [],
        tool: endMill,
        params: {
          side: "outside",
          direction: "climb",
          depth: 3,
          allowance: 0,
          finishPass: false,
          leadIn: null,
          ramp: false,
          tabs: null,
        },
      },
      {
        id: DRILL_ID,
        name: "Holes",
        enabled: true,
        stockSide: "top",
        type: "drill",
        targets: [],
        tool: drill,
        params: { depth: 6, peck: false, stepOver: 40 },
      },
    ],
  };
}

function lines(feed: number): ToolpathLines {
  return {
    feeds: new Float32Array([0, 0, -1, feed, 0, -1]),
    rapids: new Float32Array([0, 0, 5, 0, 0, 0]),
    rapidDistances: new Float32Array([0, 5]),
    holes: new Float32Array(),
    feedColors: new Float32Array(),
    kinds: new Uint8Array([1, 0]),
  };
}

function ready(toolpaths: ToolpathStore, id: string, inputHash: string, preview = lines(10)) {
  toolpaths.getState().startComputing(id, inputHash);
  toolpaths.getState().setResult(id, inputHash, { warnings: [], lines: preview });
}

describe("simulationRequest", () => {
  it("waits for every enabled toolpath, then cuts their feeds and rapids", () => {
    const document = documentWithOperations();
    const toolpaths = createToolpathStore();
    ready(toolpaths, PROFILE_ID, "a");
    toolpaths.getState().startComputing(DRILL_ID, "b");
    expect(simulationRequest(document, toolpaths.getState().entries, MAX_CELLS)).toBeNull();

    const preview = lines(20);
    ready(toolpaths, DRILL_ID, "b", preview);
    const request = simulationRequest(document, toolpaths.getState().entries, MAX_CELLS);
    expect(request?.input.stock).toEqual({ width: 600, height: 400, thickness: 18 });
    expect(request?.input.cuts).toHaveLength(4);
    expect(request?.input.cuts[2]).toEqual({
      tool: { type: "drill", diameter: 6, vAngle: null, tipDiameter: null },
      segments: preview.feeds,
    });
    expect(request?.input.cuts[3]?.segments).toBe(preview.rapids);
  });

  it("cuts a toolpath's clearing moves with the clearing tool", () => {
    const document: ProjectDocument = {
      ...createProjectDocument(),
      operations: [
        {
          id: PROFILE_ID,
          name: "Sign",
          enabled: true,
          stockSide: "top",
          type: "vcarve",
          targets: [],
          tool: vBit,
          params: { maxDepth: 3, flatBottom: { tool: endMill, stepOver: 40 } },
        },
      ],
    };
    const toolpaths = createToolpathStore();
    const carving = lines(10);
    const clearing = lines(20);
    toolpaths.getState().startComputing(PROFILE_ID, "a");
    toolpaths.getState().setResult(PROFILE_ID, "a", { warnings: [], lines: carving, clearing });
    const cuts = simulationRequest(document, toolpaths.getState().entries, MAX_CELLS)?.input.cuts;
    expect(cuts?.map(({ tool, segments }) => [tool.type, segments])).toEqual([
      ["flat_end_mill", clearing.feeds],
      ["flat_end_mill", clearing.rapids],
      ["v_bit", carving.feeds],
      ["v_bit", carving.rapids],
    ]);
  });

  it("leaves out disabled and failed operations, changing the key", () => {
    const document = documentWithOperations();
    const toolpaths = createToolpathStore();
    ready(toolpaths, PROFILE_ID, "a");
    ready(toolpaths, DRILL_ID, "b");
    const both = simulationRequest(document, toolpaths.getState().entries, MAX_CELLS);

    toolpaths.getState().startComputing(DRILL_ID, "c");
    toolpaths.getState().setError(DRILL_ID, "c", "boom");
    const failed = simulationRequest(document, toolpaths.getState().entries, MAX_CELLS);
    expect(failed?.input.cuts).toHaveLength(2);
    expect(failed?.key).not.toBe(both?.key);

    const disabled = {
      ...document,
      operations: document.operations.map((op) =>
        op.id === DRILL_ID ? { ...op, enabled: false } : op,
      ),
    };
    toolpaths.getState().startComputing(DRILL_ID, "d");
    expect(simulationRequest(disabled, toolpaths.getState().entries, MAX_CELLS)?.key).toBe(
      failed?.key,
    );
  });

  it("simulates each side of a two-sided project, the bottom from the top's cuts (ADR-0060)", () => {
    const document = documentWithOperations();
    const twoSided = {
      ...document,
      stock: { ...document.stock, twoSided: { flipAxis: "x" as const, partingDepth: 9 } },
      operations: document.operations.map((op) =>
        op.id === DRILL_ID ? { ...op, stockSide: "bottom" as const } : op,
      ),
    };
    const toolpaths = createToolpathStore();
    ready(toolpaths, PROFILE_ID, "a");
    ready(toolpaths, DRILL_ID, "b");
    // The top side: the profile's feeds and rapids only.
    const top = simulationRequest(twoSided, toolpaths.getState().entries, MAX_CELLS);
    expect(top?.input.cuts).toHaveLength(2);
    expect(top?.input.before).toBeUndefined();
    // The bottom side: the drill's, from the stock the profile leaves, turned over about X.
    const bottom = simulationRequest(twoSided, toolpaths.getState().entries, MAX_CELLS, "bottom");
    expect(bottom?.input.cuts).toHaveLength(2);
    expect(bottom?.input.before).toEqual({ cuts: top?.input.cuts, axis: "x" });
    expect(bottom?.key).not.toBe(top?.key);
  });
});

function setup() {
  const documents = createDocumentStore(documentWithOperations());
  const toolpaths = createToolpathStore();
  const requests: SimulationRequest[] = [];
  const results: SimulationResponse[] = [];
  const schedule = scheduleSimulation(
    documents,
    toolpaths,
    (request) => requests.push(request),
    (response) => results.push(response),
    MAX_CELLS,
  );
  return { documents, toolpaths, requests, results, schedule };
}

const stock = { width: 600, height: 400, thickness: 18 };

const heightmap = {
  columns: 2,
  rows: 2,
  cellWidth: 1,
  cellHeight: 1,
  heights: new Float32Array(4),
};

describe("scheduleSimulation", () => {
  it("simulates once the toolpaths are computed, and again when they or the stock change", () => {
    const { documents, toolpaths, requests, results, schedule } = setup();
    ready(toolpaths, PROFILE_ID, "a");
    expect(requests).toHaveLength(0);
    ready(toolpaths, DRILL_ID, "b");
    expect(requests).toHaveLength(1);

    const [first] = requests as [SimulationRequest];
    schedule.receive({ key: first.key, heightmap, stock });
    expect(results).toEqual([{ key: first.key, heightmap, stock }]);

    documents.getState().change("Inches", (draft) => {
      draft.units = "in";
    });
    expect(requests).toHaveLength(1);
    documents.getState().change("Thicker", (draft) => {
      draft.stock.thickness = 20;
    });
    expect(requests).toHaveLength(2);
    schedule.receive({ key: requests[1]?.key ?? "", heightmap, stock });
    ready(toolpaths, DRILL_ID, "c");
    expect(requests).toHaveLength(3);
  });

  it("keeps one request at the worker and sends only the latest next", () => {
    const { toolpaths, requests, schedule } = setup();
    ready(toolpaths, PROFILE_ID, "a");
    ready(toolpaths, DRILL_ID, "b");
    for (const hash of ["c", "d", "e"]) ready(toolpaths, DRILL_ID, hash);
    expect(requests).toHaveLength(1);

    schedule.receive({ key: requests[0]?.key ?? "", heightmap, stock });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.key).toContain('"e"');
    schedule.receive({ key: requests[1]?.key ?? "", heightmap, stock });
    expect(requests).toHaveLength(2);
  });

  it("sends the waiting request after a failure, and ignores failures while idle", () => {
    const { toolpaths, requests, results, schedule } = setup();
    ready(toolpaths, PROFILE_ID, "a");
    ready(toolpaths, DRILL_ID, "b");
    ready(toolpaths, DRILL_ID, "c");
    schedule.fail("Out of memory");
    expect(results).toEqual([{ key: requests[0]?.key, error: "Out of memory" }]);
    expect(requests).toHaveLength(2);

    schedule.receive({ key: requests[1]?.key ?? "", heightmap, stock });
    schedule.fail("The simulation worker stopped");
    expect(results).toHaveLength(2);
    expect(requests).toHaveLength(2);
  });

  it("reports a failed simulation and simulates again after a change", () => {
    const { toolpaths, requests, results, schedule } = setup();
    ready(toolpaths, PROFILE_ID, "a");
    ready(toolpaths, DRILL_ID, "b");
    schedule.fail("The simulation worker stopped");
    expect(results).toEqual([{ key: requests[0]?.key, error: "The simulation worker stopped" }]);
    ready(toolpaths, DRILL_ID, "c");
    expect(requests).toHaveLength(2);
  });

  it("stops listening", () => {
    const { toolpaths, requests, schedule } = setup();
    schedule.stop();
    ready(toolpaths, PROFILE_ID, "a");
    ready(toolpaths, DRILL_ID, "b");
    expect(requests).toHaveLength(0);
  });
});
