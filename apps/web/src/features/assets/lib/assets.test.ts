import { model } from "@furrow/document/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discardUpload, downloadAsset, uploadAsset } from "./assets";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const SHA = model.sha256;

const actions = vi.hoisted(() => ({
  requestAssetUpload: vi.fn(),
  verifyAssetUpload: vi.fn(),
  getAssetUrl: vi.fn(),
  discardAsset: vi.fn(),
}));
vi.mock("@/features/assets/actions", () => actions);

const fetchMock = vi.fn<typeof fetch>();
const file = new Blob(["solid"]);
const upload = { url: "https://storage/put", headers: { "if-none-match": "*" } };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  actions.verifyAssetUpload.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("uploadAsset", () => {
  it("uploads the file with the signed headers, then verifies it", async () => {
    actions.requestAssetUpload.mockResolvedValue({ upload });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    expect(await uploadAsset(PROJECT, SHA, file, "mesh")).toEqual({ uploaded: true });
    expect(actions.requestAssetUpload).toHaveBeenCalledWith(PROJECT, SHA, file.size, "mesh");
    expect(fetchMock).toHaveBeenCalledWith(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: file,
    });
    expect(actions.verifyAssetUpload).toHaveBeenCalledWith(PROJECT, SHA);
  });

  it("skips uploading a file the project already has", async () => {
    actions.requestAssetUpload.mockResolvedValue({ uploaded: true });
    expect(await uploadAsset(PROJECT, SHA, file, "mesh")).toEqual({ uploaded: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(actions.verifyAssetUpload).not.toHaveBeenCalled();
  });

  it("verifies when an earlier upload already stored the file", async () => {
    actions.requestAssetUpload.mockResolvedValue({ upload });
    fetchMock.mockResolvedValue(new Response(null, { status: 412 }));
    expect(await uploadAsset(PROJECT, SHA, file, "mesh")).toEqual({ uploaded: true });
    expect(actions.verifyAssetUpload).toHaveBeenCalled();
  });

  it("returns the server's refusals and upload failures", async () => {
    actions.requestAssetUpload.mockResolvedValue({ error: "STL import isn't available." });
    expect(await uploadAsset(PROJECT, SHA, file, "mesh")).toEqual({
      error: "STL import isn't available.",
    });

    actions.requestAssetUpload.mockResolvedValue({ upload });
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await uploadAsset(PROJECT, SHA, file, "mesh")).error).toMatch(/couldn't be uploaded/);

    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    actions.verifyAssetUpload.mockResolvedValue({ error: "Doesn't match." });
    expect(await uploadAsset(PROJECT, SHA, file, "mesh")).toEqual({ error: "Doesn't match." });

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect((await uploadAsset(PROJECT, SHA, file, "mesh")).error).toMatch(/couldn't be uploaded/);
  });
});

describe("discardUpload", () => {
  it("asks the server to delete the mesh, and only logs failures", async () => {
    actions.discardAsset.mockResolvedValue(undefined);
    await discardUpload(PROJECT, SHA);
    expect(actions.discardAsset).toHaveBeenCalledWith(PROJECT, SHA);
    expect(console.error).not.toHaveBeenCalled();

    actions.discardAsset.mockResolvedValue({ error: "This project no longer exists." });
    await discardUpload(PROJECT, SHA);
    actions.discardAsset.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(discardUpload(PROJECT, SHA)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("downloadAsset", () => {
  it("downloads through a presigned URL", async () => {
    actions.getAssetUrl.mockResolvedValue({ url: "https://storage/get" });
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    expect(new Uint8Array(await downloadAsset(PROJECT, SHA))).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledWith("https://storage/get");
  });

  it("throws a message for the user when it can't", async () => {
    actions.getAssetUrl.mockResolvedValue({ error: "This mesh hasn't been uploaded." });
    await expect(downloadAsset(PROJECT, SHA)).rejects.toThrow("This mesh hasn't been uploaded.");
    actions.getAssetUrl.mockResolvedValue({ url: "https://storage/get" });
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(downloadAsset(PROJECT, SHA)).rejects.toThrow(/couldn't be downloaded/);
  });
});
