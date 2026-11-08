// @vitest-environment jsdom

import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { createProjectDocument } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import type { GeneratedTerrain } from "../lib/mesh-worker-protocol";
import { renderWorkspace } from "../test-render";
import { TerrainButton } from "./terrain-dialog";

const download = vi.hoisted(() => vi.fn());
vi.mock("@furrow/ui/lib/download", () => ({ downloadFile: download }));

/** The map: one button that "draws" a small area near Lecco. */
vi.mock("./terrain-map", () => ({
  default: ({ onArea }: { onArea: (ring: [number, number][]) => void }) => (
    <button
      type="button"
      onClick={() =>
        onArea([
          [9.37, 45.9],
          [9.41, 45.9],
          [9.41, 45.93],
          [9.37, 45.93],
        ])
      }
    >
      Draw
    </button>
  ),
}));

const terrain: GeneratedTerrain = {
  sha256: "a".repeat(64),
  triangles: 12,
  bounds: { min: [0, 0, 0], max: [200, 150, 30] },
  stl: new ArrayBuffer(84 + 12 * 50),
  size: [200, 150, 30],
  heights: [400, 2400],
  cellMetres: 6,
  outline: [],
};

/** The terrain worker: the height preview answers at once, a full terrain when `finish` is called. */
let finish: () => void = () => {};
const generate = vi.hoisted(() => vi.fn());
vi.mock("../lib/terrain-import", async (actual) => ({
  ...(await actual<typeof import("../lib/terrain-import")>()),
  generateTerrain: generate,
}));

beforeEach(() => {
  download.mockReset();
  generate.mockReset();
  generate.mockImplementation(
    (
      _ring: unknown,
      _settings: unknown,
      limits: { maxTriangles: number },
      options?: { signal?: AbortSignal },
    ) =>
      limits.maxTriangles < DEFAULT_STL_LIMITS.maxTriangles / 10
        ? Promise.resolve(terrain)
        : new Promise((resolve, reject) => {
            finish = () => resolve(terrain);
            options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")));
          }),
  );
  localStorage.setItem("furrow:terrain-services", "1");
});

async function openWithArea(host = createMemoryHost({ document: createProjectDocument() })) {
  renderWorkspace(<TerrainButton inRibbon />, host);
  fireEvent.click(screen.getByRole("button", { name: "Terrain from a map" }));
  fireEvent.click(await screen.findByRole("button", { name: "Draw" }));
  await screen.findByText(/^Heights:/);
  return host;
}

describe("TerrainDialog", () => {
  it("downloads the terrain as STL without adding a model", async () => {
    const host = await openWithArea();
    fireEvent.click(screen.getByRole("button", { name: "Download STL" }));
    finish();
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]?.slice(1)).toEqual(["Terrain.stl", "model/stl"]);
    expect(host.stored.document().models).toEqual([]);
  });

  it("only downloads in a project that has its model", async () => {
    await openWithArea(
      createMemoryHost(
        { document: { ...createProjectDocument(), models: [model] } },
        { limits: { meshes: DEFAULT_STL_LIMITS, fonts: null } },
      ),
    );
    expect(screen.getByRole("button", { name: "Generate" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/has its 3D model already/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download STL" })).toHaveProperty("disabled", false);
    // A download isn't held to the stock: a side twice the stock's width is taken.
    const side = screen.getByLabelText(/Longest side/);
    fireEvent.change(side, { target: { value: "1200" } });
    fireEvent.blur(side);
    fireEvent.click(screen.getByRole("button", { name: "Download STL" }));
    finish();
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(generate.mock.lastCall?.[1]).toMatchObject({ longestSide: 1200 });
  });

  it("only downloads where the server can't store meshes", async () => {
    await openWithArea();
    expect(screen.getByRole("button", { name: "Generate" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/can't store 3D models/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download STL" })).toHaveProperty("disabled", false);
  });

  it("adds the terrain where it can be stored", async () => {
    const host = await openWithArea(
      createMemoryHost(
        { document: createProjectDocument() },
        { limits: { meshes: DEFAULT_STL_LIMITS, fonts: null } },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    finish();
    await waitFor(() => expect(host.stored.meshes.size).toBe(1));
    expect(download).not.toHaveBeenCalled();
  });

  it("downloads nothing when cancelled as the worker finishes", async () => {
    await openWithArea();
    fireEvent.click(screen.getByRole("button", { name: "Download STL" }));
    // The terrain is ready, but the dialog hasn't taken it yet when Cancel is clicked.
    finish();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(download).not.toHaveBeenCalled();
  });

  it("tells the host when its services may be reached: only while it is open", () => {
    const terrainServices = vi.fn();
    renderWorkspace(
      <TerrainButton inRibbon />,
      createMemoryHost({ document: createProjectDocument() }, { terrainServices }),
    );
    expect(terrainServices).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Terrain from a map" }));
    expect(terrainServices.mock.calls).toEqual([[true]]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(terrainServices.mock.calls).toEqual([[true], [false]]);
  });
});
