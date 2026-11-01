// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useDocumentStoreApi } from "../providers/workspace-stores";
import { type DocumentStore, versionLabel } from "../stores/document-store";
import { renderWorkspace } from "../test-render";
import { VersionsPane } from "./versions-pane";

/** The document store of the rendered workspace, kept by `Probe`. */
let store: DocumentStore | undefined;
function Probe() {
  store = useDocumentStoreApi();
  return null;
}

describe("VersionsPane", () => {
  it("lists the host's versions", async () => {
    const host = createMemoryHost({ document: createProjectDocument() });
    await host.versions?.create("Before pockets", host.project.savedAt);
    renderWorkspace(<VersionsPane />, host);
    expect(await screen.findByText("Before pockets")).toBeTruthy();
    expect(screen.queryByText("Loading versions…")).toBeNull();
  });

  it("stops loading and says why when the list request fails", async () => {
    const host = createMemoryHost({ document: createProjectDocument() });
    if (host.versions) host.versions.list = () => Promise.reject(new Error("offline"));
    renderWorkspace(<VersionsPane />, host);
    expect(await screen.findByText("offline")).toBeTruthy();
    expect(screen.queryByText("Loading versions…")).toBeNull();
  });

  it("names exports after the version just saved, until the document changes", async () => {
    renderWorkspace(
      <>
        <Probe />
        <VersionsPane />
      </>,
      createMemoryHost({ document: createProjectDocument() }),
    );
    fireEvent.change(screen.getByLabelText("Version label"), { target: { value: " Final " } });
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    expect(await screen.findByText("Final")).toBeTruthy();
    const state = () => (store as DocumentStore).getState();
    await waitFor(() => expect(versionLabel(state())).toBe("Final"));
    state().change("setWidth", (doc) => {
      doc.stock.width += 1;
    });
    expect(versionLabel(state())).toBeNull();
  });
});
