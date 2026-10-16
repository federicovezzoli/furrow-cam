import { generateToolpath, type ToolpathInput, toolpathLines } from "@furrow/cam-core";
import { createProjectDocument, type ProjectDocument, type Tool } from "@furrow/document";
import { describe, expect, it, vi } from "vitest";
import { createDocumentStore, type DocumentStore } from "./document-store";
import {
  scheduleToolpaths,
  type ToolpathMessage,
  type ToolpathRequest,
} from "./toolpath-scheduler";
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
        targets: [{ shapeId: SHAPE_ID, paths: null }],
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
  const cancels: string[] = [];
  const meshes: string[] = [];
  const post = (message: ToolpathMessage) => {
    if ("cancel" in message) cancels.push(message.cancel);
    else requests.push(message);
  };
  const schedule = scheduleToolpaths(documents, toolpaths, post, async (sha256) => {
    meshes.push(sha256);
    return new ArrayBuffer(8);
  });
  return { documents, toolpaths, requests, cancels, meshes, schedule };
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
  return { warnings: result.warnings, lines: toolpathLines(result) };
}

describe("scheduleToolpaths", () => {
  it("requests enabled operations and files the worker's results", () => {
    const { toolpaths, requests, schedule } = setup();
    expect(requests).toHaveLength(1);
    const [request] = requests as [ToolpathRequest];
    expect(toolpaths.getState().entries[OPERATION_ID]?.status).toBe("computing");

    const preview = compute(request.input);
    schedule.receive({ operationId: OPERATION_ID, inputHash: request.inputHash, ...preview });
    expect(toolpaths.getState().entries[OPERATION_ID]).toEqual({
      inputHash: request.inputHash,
      status: "ready",
      ...preview,
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

  it("asks the worker to stop a request whose operation changed, once", () => {
    const { documents, toolpaths, requests, cancels, schedule } = setup();
    for (const depth of [4, 5]) deepen(documents, depth);
    expect(cancels).toEqual([OPERATION_ID]);
    const [first] = requests as [ToolpathRequest];
    schedule.receive({ ...first, cancelled: true });
    // The latest inputs go next; the cancelled request leaves no trace.
    expect(requests).toHaveLength(2);
    expect(toolpaths.getState().entries[OPERATION_ID]).toMatchObject({
      status: "computing",
      inputHash: requests[1]?.inputHash,
    });
  });

  it("asks the worker to stop a request whose operation was disabled", () => {
    const { documents, cancels } = setup();
    documents.getState().change("Disable", (draft) => {
      const operation = draft.operations[0];
      if (operation) operation.enabled = false;
    });
    expect(cancels).toEqual([OPERATION_ID]);
  });

  it("files progress until the toolpath arrives", () => {
    const { toolpaths, requests, schedule } = setup();
    const [first] = requests as [ToolpathRequest];
    schedule.receive({ ...first, progress: 0.4 });
    expect(toolpaths.getState().entries[OPERATION_ID]).toMatchObject({
      status: "computing",
      progress: 0.4,
    });
    schedule.receive({ ...first, ...compute(first.input) });
    schedule.receive({ ...first, progress: 0.9 });
    expect(toolpaths.getState().entries[OPERATION_ID]?.status).toBe("ready");
  });

  it("cancels on request and computes again on retry", () => {
    const { toolpaths, requests, cancels, schedule } = setup();
    schedule.cancel(OPERATION_ID);
    expect(cancels).toEqual([OPERATION_ID]);
    const [first] = requests as [ToolpathRequest];
    schedule.receive({ ...first, cancelled: true });
    expect(toolpaths.getState().entries[OPERATION_ID]).toMatchObject({
      status: "error",
      cancelled: true,
    });
    expect(requests).toHaveLength(1);

    schedule.retry(OPERATION_ID);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputHash).toBe(first.inputHash);
    expect(toolpaths.getState().entries[OPERATION_ID]?.status).toBe("computing");
  });

  it("sends the request again with the mesh the worker lacks", async () => {
    const { toolpaths, requests, meshes, schedule } = setup();
    const [first] = requests as [ToolpathRequest];
    schedule.receive({ ...first, missingMesh: "abc" });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(meshes).toEqual(["abc"]);
    expect(requests[1]).toEqual({ ...first, mesh: expect.any(ArrayBuffer) });
    expect(toolpaths.getState().entries[OPERATION_ID]?.status).toBe("computing");
  });

  it("reports a mesh that can't be loaded", async () => {
    const documents = createDocumentStore(documentWithProfile());
    const toolpaths = createToolpathStore();
    const requests: ToolpathRequest[] = [];
    const schedule = scheduleToolpaths(
      documents,
      toolpaths,
      (message) => {
        if (!("cancel" in message)) requests.push(message);
      },
      () => Promise.reject(new Error("offline")),
    );
    const [first] = requests as [ToolpathRequest];
    schedule.receive({ ...first, missingMesh: "abc" });
    await vi.waitFor(() =>
      expect(toolpaths.getState().entries[OPERATION_ID]).toMatchObject({ error: "offline" }),
    );
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
