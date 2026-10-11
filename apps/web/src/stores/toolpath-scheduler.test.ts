import { generateToolpath } from "@furrow/cam-core";
import { createProjectDocument, type ProjectDocument, type Tool } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
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

describe("scheduleToolpaths", () => {
  it("requests enabled operations and files the worker's results", () => {
    const { toolpaths, requests, schedule } = setup();
    expect(requests).toHaveLength(1);
    const [request] = requests as [ToolpathRequest];
    expect(toolpaths.getState().entries[OPERATION_ID]?.status).toBe("computing");

    const result = generateToolpath(request.input);
    schedule.receive({ operationId: OPERATION_ID, inputHash: request.inputHash, result });
    expect(toolpaths.getState().entries[OPERATION_ID]).toMatchObject({ status: "ready", result });
  });

  it("recomputes only when an operation's inputs change", () => {
    const { documents, requests } = setup();
    documents.getState().change("Edit stock", (draft) => {
      draft.stock.width = 500;
    });
    expect(requests).toHaveLength(1);

    documents.getState().change("Deeper", (draft) => {
      const operation = draft.operations[0];
      if (operation?.type === "profile") operation.params.depth = 6;
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputHash).not.toBe(requests[0]?.inputHash);
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
    schedule.stop();
    documents.getState().change("Deeper", (draft) => {
      const operation = draft.operations[0];
      if (operation?.type === "profile") operation.params.depth = 6;
    });
    expect(requests).toHaveLength(1);
  });
});
