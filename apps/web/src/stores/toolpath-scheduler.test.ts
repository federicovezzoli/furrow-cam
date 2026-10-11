import { generateToolpath, type ToolpathInput, toolpathLines } from "@furrow/cam-core";
import { createProjectDocument, type ProjectDocument, type Tool } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { createDocumentStore, type DocumentStore } from "./document-store";
import { scheduleToolpaths, type ToolpathRequest } from "./toolpath-scheduler";
import { createToolpathStore } from "./toolpath-store";

const SHAPE_ID = "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b";
const OPERATION_ID = "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a";

const tool: Tool = {
  name: "6 mm upcut",
  type: "flat_end_mill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 24000,
  feedRate: 600,
  plungeRate: 300,
  plungeAngle: 3,
  stepDown: 1,
  stepOver: 40,
  notes: null,
  color: "#2563eb",
};

function documentWithProfile(): ProjectDocument {
  return {
    ...createProjectDocument(),
    geometry: [
      {
        id: SHAPE_ID,
        name: "Square",
        layer: "0",
        paths: [
          {
            start: [10, 10],
            segments: [
              { kind: "line", to: [60, 10] },
              { kind: "line", to: [60, 60] },
              { kind: "line", to: [10, 60] },
            ],
            closed: true,
          },
        ],
      },
    ],
    operations: [
      {
        id: OPERATION_ID,
        name: "Outside",
        enabled: true,
        type: "profile",
        shapeIds: [SHAPE_ID],
        tool,
        params: {
          side: "outside",
          direction: "climb",
          depth: 3,
          allowance: 0,
          finishPass: false,
          leadIn: null,
          ramp: true,
          tabs: null,
        },
      },
    ],
  };
}

function setup() {
  const documents = createDocumentStore(documentWithProfile());
  const toolpaths = createToolpathStore();
  const requests: ToolpathRequest[] = [];
  const schedule = scheduleToolpaths(documents, toolpaths, (request) => requests.push(request));
  return { documents, toolpaths, requests, schedule };
}

function deepen(documents: DocumentStore, depth: number) {
  documents.getState().change("Depth", (draft) => {
    const operation = draft.operations[0];
    if (operation?.type === "profile") operation.params.depth = depth;
  });
}

/** What the worker answers for `input`. */
function compute(input: ToolpathInput) {
  const result = generateToolpath(input);
  return { result, lines: toolpathLines(result) };
}

describe("scheduleToolpaths", () => {
  it("requests enabled operations and files the worker's results", () => {
    const { toolpaths, requests, schedule } = setup();
    expect(requests).toHaveLength(1);
    const [request] = requests as [ToolpathRequest];
    expect(toolpaths.getState().entries[OPERATION_ID]?.status).toBe("computing");

    const { result, lines } = compute(request.input);
    schedule.receive({ operationId: OPERATION_ID, inputHash: request.inputHash, result, lines });
    expect(toolpaths.getState().entries[OPERATION_ID]).toMatchObject({
      status: "ready",
      result,
      lines,
    });
  });

  it("recomputes only when what the toolpath depends on changes", () => {
    const { documents, requests, schedule } = setup();
    const answer = () => {
      const request = requests.at(-1) as ToolpathRequest;
      schedule.receive({ ...request, ...compute(request.input) });
    };
    answer();
    documents.getState().change("Edit stock", (draft) => {
      draft.stock.width = 500;
    });
    documents.getState().change("Rename", (draft) => {
      const operation = draft.operations[0];
      const shape = draft.geometry[0];
      if (operation && shape) {
        operation.name = "Renamed";
        operation.tool.color = "#dc2626";
        shape.name = "Renamed";
      }
    });
    expect(requests).toHaveLength(1);

    deepen(documents, 6);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputHash).not.toBe(requests[0]?.inputHash);
  });

  it("keeps one request per operation at the worker and sends only the latest next", () => {
    const { documents, toolpaths, requests, schedule } = setup();
    for (const depth of [4, 5, 6]) deepen(documents, depth);
    expect(requests).toHaveLength(1);

    const [first] = requests as [ToolpathRequest];
    schedule.receive({ ...first, ...compute(first.input) });
    // The first result is stale: the operation computes the latest inputs.
    expect(toolpaths.getState().entries[OPERATION_ID]?.status).toBe("computing");
    expect(requests).toHaveLength(2);
    const latest = requests[1] as ToolpathRequest;
    expect(latest.input.operation.type === "profile" && latest.input.operation.params.depth).toBe(
      6,
    );

    schedule.receive({ ...latest, ...compute(latest.input) });
    expect(toolpaths.getState().entries[OPERATION_ID]?.status).toBe("ready");
    expect(requests).toHaveLength(2);
  });

  it("fails pending toolpaths and sends again after a change", () => {
    const { documents, toolpaths, requests, schedule } = setup();
    deepen(documents, 6);
    schedule.fail("The toolpath worker stopped");
    expect(toolpaths.getState().entries[OPERATION_ID]).toMatchObject({
      status: "error",
      error: "The toolpath worker stopped",
    });
    expect(requests).toHaveLength(1);

    deepen(documents, 5);
    expect(requests).toHaveLength(2);
  });

  it("drops toolpaths of disabled operations and reports errors", () => {
    const { documents, toolpaths, requests, schedule } = setup();
    schedule.receive({ operationId: OPERATION_ID, inputHash: "stale", error: "ignored" });
    expect(toolpaths.getState().entries[OPERATION_ID]?.status).toBe("computing");
    schedule.receive({
      operationId: OPERATION_ID,
      inputHash: requests[0]?.inputHash ?? "",
      error: "boom",
    });
    expect(toolpaths.getState().entries[OPERATION_ID]).toMatchObject({ error: "boom" });

    documents.getState().change("Disable", (draft) => {
      const operation = draft.operations[0];
      if (operation) operation.enabled = false;
    });
    expect(toolpaths.getState().entries).toEqual({});
  });

  it("stops listening", () => {
    const { documents, requests, schedule } = setup();
    const [first] = requests as [ToolpathRequest];
    schedule.receive({ ...first, ...compute(first.input) });
    schedule.stop();
    deepen(documents, 6);
    expect(requests).toHaveLength(1);
  });
});
