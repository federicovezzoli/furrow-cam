// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { renderWorkspace } from "../test-render";
import { VersionsPane } from "./versions-pane";

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
});
