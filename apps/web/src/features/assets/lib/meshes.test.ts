import { model } from "@furrow/document/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadMesh, uploadMesh } from "./meshes";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const SHA = model.sha256;

const actions = vi.hoisted(() => ({
  requestMeshUpload: vi.fn(),
  verifyMeshUpload: vi.fn(),
  getMeshUrl: vi.fn(),
}));
vi.mock("@/features/assets/actions", () => actions);

const fetchMock = vi.fn<typeof fetch>();
const file = new Blob(["solid"]);
const upload = { url: "https://storage/put", headers: { "if-none-match": "*" } };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  actions.verifyMeshUpload.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("uploadMesh", () => {
  it("uploads the file with the signed headers, then verifies it", async () => {
    actions.requestMeshUpload.mockResolvedValue({ upload });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    expect(await uploadMesh(PROJECT, SHA, file)).toBeUndefined();
    expect(actions.requestMeshUpload).toHaveBeenCalledWith(PROJECT, SHA, file.size);
    expect(fetchMock).toHaveBeenCalledWith(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: file,
    });
    expect(actions.verifyMeshUpload).toHaveBeenCalledWith(PROJECT, SHA);
  });

  it("skips uploading a file the project already has", async () => {
    actions.requestMeshUpload.mockResolvedValue({ uploaded: true });
    expect(await uploadMesh(PROJECT, SHA, file)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(actions.verifyMeshUpload).not.toHaveBeenCalled();
  });

  it("verifies when an earlier upload already stored the file", async () => {
    actions.requestMeshUpload.mockResolvedValue({ upload });
    fetchMock.mockResolvedValue(new Response(null, { status: 412 }));
    expect(await uploadMesh(PROJECT, SHA, file)).toBeUndefined();
    expect(actions.verifyMeshUpload).toHaveBeenCalled();
  });

  it("returns the server's refusals and upload failures", async () => {
    actions.requestMeshUpload.mockResolvedValue({ error: "STL import isn't available." });
    expect(await uploadMesh(PROJECT, SHA, file)).toBe("STL import isn't available.");

    actions.requestMeshUpload.mockResolvedValue({ upload });
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    expect(await uploadMesh(PROJECT, SHA, file)).toMatch(/couldn't be uploaded/);

    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    actions.verifyMeshUpload.mockResolvedValue({ error: "Doesn't match." });
    expect(await uploadMesh(PROJECT, SHA, file)).toBe("Doesn't match.");

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await uploadMesh(PROJECT, SHA, file)).toMatch(/couldn't be uploaded/);
  });
});

describe("downloadMesh", () => {
  it("downloads through a presigned URL", async () => {
    actions.getMeshUrl.mockResolvedValue({ url: "https://storage/get" });
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    expect(new Uint8Array(await downloadMesh(PROJECT, SHA))).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledWith("https://storage/get");
  });

  it("throws a message for the user when it can't", async () => {
    actions.getMeshUrl.mockResolvedValue({ error: "This mesh hasn't been uploaded." });
    await expect(downloadMesh(PROJECT, SHA)).rejects.toThrow("This mesh hasn't been uploaded.");
    actions.getMeshUrl.mockResolvedValue({ url: "https://storage/get" });
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(downloadMesh(PROJECT, SHA)).rejects.toThrow(/couldn't be downloaded/);
  });
});
