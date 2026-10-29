// @vitest-environment jsdom
import type { ProjectDocument } from "@furrow/document";
import { fullDocument, model, OPERATION_ID, reliefFinish } from "@furrow/document/fixtures";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useDocumentStoreApi } from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import { defaultPocketParams } from "../stores/operation-actions";
import { renderWorkspace } from "../test-render";
import { OperationProperties } from "./operation-properties";

let store: DocumentStore;

function Store() {
  store = useDocumentStoreApi();
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
});
