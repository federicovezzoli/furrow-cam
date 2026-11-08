// @vitest-environment jsdom

import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { createProjectDocument } from "@furrow/document";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { renderWorkspace } from "../test-render";
import { TerrainButton } from "./terrain-dialog";

describe("TerrainDialog", () => {
  it("tells the host when its services may be reached: only while it is open", () => {
    const terrainServices = vi.fn();
    renderWorkspace(
      <TerrainButton inRibbon />,
      createMemoryHost(
        { document: createProjectDocument() },
        { terrainServices, limits: { meshes: DEFAULT_STL_LIMITS, fonts: null } },
      ),
    );
    expect(terrainServices).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Terrain from a map" }));
    expect(terrainServices.mock.calls).toEqual([[true]]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(terrainServices.mock.calls).toEqual([[true], [false]]);
  });
});
