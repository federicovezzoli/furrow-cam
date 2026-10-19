import { describe, expect, it, vi } from "vitest";
import { MESH_CONTENT_TYPE, presignDownload, presignUpload } from "./server";

vi.mock("@/env", () => ({
  env: {
    S3_ENDPOINT: "http://storage.test",
    S3_REGION: "auto",
    S3_BUCKET: "meshes",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
    STL_MAX_FILE_MB: 50,
    STL_MAX_TRIANGLES: 2_000_000,
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));

const SHA = "a".repeat(64);

describe("presignUpload", () => {
  it("signs the mesh content type into the upload, so storage rejects any other", async () => {
    const { url, headers } = await presignUpload("user/project/sha", 1234, SHA);
    expect(headers["content-type"]).toBe(MESH_CONTENT_TYPE);
    const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders")?.split(";");
    expect(signed).toEqual(expect.arrayContaining(Object.keys(headers)));
    expect(signed).toContain("content-length");
  });
});

describe("presignDownload", () => {
  it("serves every mesh as an octet-stream attachment, whatever it was stored as", async () => {
    const params = new URL(await presignDownload("user/project/sha")).searchParams;
    expect(params.get("response-content-type")).toBe(MESH_CONTENT_TYPE);
    expect(params.get("response-content-disposition")).toBe("attachment");
  });
});
