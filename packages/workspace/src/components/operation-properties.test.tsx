// @vitest-environment jsdom
import type { ProjectDocument } from "@furrow/document";
import {
  fullDocument,
  model,
  OPERATION_ID,
  reliefFinish,
  SQUARE_ID,
} from "@furrow/document/fixtures";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useDocumentStoreApi, useWorkspaceStoreApi } from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import { defaultPocketParams } from "../stores/operation-actions";
import type { WorkspaceStore } from "../stores/workspace-store";
import { renderWorkspace } from "../test-render";
import { OperationProperties } from "./operation-properties";

let store: DocumentStore;
let workspace: WorkspaceStore;

function Store() {
  store = useDocumentStoreApi();
  workspace = useWorkspaceStoreApi();
  return null;
}

/** `fullDocument` with its profile turned into a pocket. */
function withPocket(): ProjectDocument {
  const doc = fullDocument();
  const [profile] = doc.operations;
  if (profile?.type !== "profile") throw new Error("The fixture has no profile");
  const { params: _, ...rest } = profile;
  return {
    ...doc,
    operations: [{ ...rest, type: "pocket", name: "Pocket", params: defaultPocketParams(doc) }],
  };
}

describe("OperationProperties", () => {
  it("sets the side of the paths a pocket clears (#386)", () => {
    renderWorkspace(
      <>
        <Store />
        <OperationProperties operationId={OPERATION_ID} />
      </>,
      createMemoryHost({ document: withPocket() }),
    );
    fireEvent.change(screen.getByLabelText("Side"), { target: { value: "outside" } });
    const [pocket] = store.getState().document.operations;
    expect(pocket?.type === "pocket" && pocket.params.side).toBe("outside");
  });

  it("sets what 3D finishing covers, with a margin (#396)", () => {
    const doc = { ...fullDocument(), models: [model], operations: [reliefFinish] };
    renderWorkspace(
      <>
        <Store />
        <OperationProperties operationId={reliefFinish.id} />
      </>,
      createMemoryHost({ document: doc }),
    );
    fireEvent.change(screen.getByLabelText("Cover"), { target: { value: "margin" } });
    const [finish] = store.getState().document.operations;
    expect(finish?.type === "relief_finish" && finish.params.boundary).toEqual({
      type: "margin",
      distance: 5,
    });
    expect(screen.getByText("Margin")).toBeTruthy();
  });

  it("edits start points in the viewport, ending tab editing (#426)", () => {
    renderWorkspace(
      <>
        <Store />
        <OperationProperties operationId={OPERATION_ID} />
      </>,
      createMemoryHost({ document: fullDocument() }),
    );
    workspace.getState().selectOperation(OPERATION_ID);
    workspace.getState().setView("orbit");
    expect(screen.getByText("1 start point")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit start points" }));
    expect(workspace.getState()).toMatchObject({ editing: "startPoints", view: "top" });
    expect(screen.getByText(/Click a path to add a start point/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit in viewport" }));
    expect(workspace.getState().editing).toBe("tabs");
    expect(screen.queryByText(/Click a path to add a start point/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit start points" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(workspace.getState().editing).toBeNull();
  });

  it("places a drill's holes in the viewport (#429)", () => {
    const doc = fullDocument();
    const [profile] = doc.operations;
    if (profile?.type !== "profile") throw new Error("The fixture has no profile");
    const { params: _, ...rest } = profile;
    doc.operations = [
      {
        ...rest,
        type: "drill",
        targets: [{ shapeId: SQUARE_ID, paths: null }],
        params: { depth: 5, peck: false, stepOver: 40, pins: false, points: [[10, 20]] },
      },
    ];
    renderWorkspace(
      <>
        <Store />
        <OperationProperties operationId={OPERATION_ID} />
      </>,
      createMemoryHost({ document: doc }),
    );
    workspace.getState().selectOperation(OPERATION_ID);
    expect(screen.getByText("1 placed hole")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place holes" }));
    expect(workspace.getState()).toMatchObject({ editing: "holes", view: "top" });
    expect(screen.getByText(/Click to place a hole/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(workspace.getState().editing).toBeNull();
    // With placed holes, the drill's last shape can go too.
    fireEvent.click(screen.getByRole("button", { name: /^Remove / }));
    expect(store.getState().document.operations[0]?.targets).toEqual([]);
  });

  it("turns corner overcuts off and on, and off on the line (#428)", () => {
    renderWorkspace(
      <>
        <Store />
        <OperationProperties operationId={OPERATION_ID} />
      </>,
      createMemoryHost({ document: fullDocument() }),
    );
    const overcuts = () => {
      const [profile] = store.getState().document.operations;
      return profile?.type === "profile" ? profile.params.cornerOvercuts : undefined;
    };
    workspace.getState().selectOperation(OPERATION_ID);
    fireEvent.click(screen.getByRole("button", { name: "Edit overcuts" }));
    expect(workspace.getState()).toMatchObject({ editing: "overcuts", view: "top" });
    expect(screen.getByText(/Click an overcut to leave it out/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Corner overcuts"));
    expect(workspace.getState().editing).toBeNull();
    expect(overcuts()).toBeNull();
    fireEvent.click(screen.getByLabelText("Corner overcuts"));
    expect(overcuts()).toEqual({ maxAngle: 90, excluded: [] });
    fireEvent.change(screen.getByLabelText("Side"), { target: { value: "on" } });
    expect(overcuts()).toBeNull();
    expect(screen.getByText("Needs an inside or outside profile.")).toBeTruthy();
  });
});

describe("OperationProperties: hidden objects (ADR-0080)", () => {
  it("says an operation is off while all it cuts is hidden, rather than computing", () => {
    const document = fullDocument();
    renderWorkspace(
      <OperationProperties operationId={OPERATION_ID} />,
      createMemoryHost({
        document: { ...document, drawings: document.drawings.map((d) => ({ ...d, hidden: true })) },
      }),
    );
    expect(screen.getByText(/all it cuts is hidden/)).toBeTruthy();
    expect(screen.queryByText("Computing toolpath…")).toBeNull();
  });
});
