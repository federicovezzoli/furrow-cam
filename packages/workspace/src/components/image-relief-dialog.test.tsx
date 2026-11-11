// @vitest-environment jsdom

import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { createProjectDocument } from "@furrow/document";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import type { GeneratedRelief } from "../lib/mesh-worker-protocol";
import { renderWorkspace } from "../test-render";
import { ImageReliefButton } from "./image-relief-dialog";

const download = vi.hoisted(() => vi.fn());
vi.mock("@furrow/ui/lib/download", () => ({ downloadFile: download }));

/** The 3D preview needs WebGL, which jsdom hasn't: it only says what it shows. */
vi.mock("./terrain-preview", () => ({
  default: ({ size }: { size: number[] }) => <p>Preview {size.join(" × ")}</p>,
}));

const relief: GeneratedRelief = {
  sha256: "b".repeat(64),
  triangles: 12,
  bounds: { min: [0, 0, 0], max: [200, 100, 8] },
  stl: new ArrayBuffer(84 + 12 * 50),
  size: [200, 100, 8],
  cells: [39, 19],
};

const generate = vi.hoisted(() => vi.fn());
vi.mock("../lib/image-relief-import", () => ({
  generateRelief: generate,
  imageSize: async () => [400, 200],
}));

beforeEach(() => {
  download.mockReset();
  generate.mockReset();
  generate.mockResolvedValue(relief);
});

async function openWithImage(host = createMemoryHost({ document: createProjectDocument() })) {
  const { container } = renderWorkspace(<ImageReliefButton inRibbon />, host);
  fireEvent.click(screen.getByRole("button", { name: "Relief from image" }));
  expect(screen.getByText(/Pick an image to see/)).toBeTruthy();
  const input = (container.ownerDocument as Document).querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const file = new File([new Uint8Array(8)], "Logo.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByText("Preview 200 × 100 × 8")).toBeTruthy();
  expect(screen.getByText(/400 × 200 px/)).toBeTruthy();
  return host;
}

describe("ImageReliefDialog", () => {
  it("makes the preview again as the settings change", async () => {
    await openWithImage();
    const previews = generate.mock.calls.length;
    fireEvent.click(screen.getByLabelText("Invert"));
    await waitFor(() => expect(generate.mock.calls.length).toBe(previews + 1));
    expect(generate.mock.lastCall?.[1]).toMatchObject({ invert: true, relief: 5, base: 3 });
    // Sized to fit the stock by default, half as deep as wide like the image.
    expect(generate.mock.lastCall?.[1].width).toBeGreaterThan(0);
  });

  it("downloads the relief as STL, named after the image", async () => {
    const host = await openWithImage();
    expect(screen.getByRole("button", { name: "Add to project" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Download STL" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]?.slice(1)).toEqual(["Logo.stl", "model/stl"]);
    expect(host.stored.document().models).toEqual([]);
  });

  it("adds the relief where it can be stored", async () => {
    const host = await openWithImage(
      createMemoryHost(
        { document: createProjectDocument() },
        { limits: { meshes: DEFAULT_STL_LIMITS, fonts: null } },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to project" }));
    await waitFor(() => expect(host.stored.meshes.size).toBe(1));
  });
});
