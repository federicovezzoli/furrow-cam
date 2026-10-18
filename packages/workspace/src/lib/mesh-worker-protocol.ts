import type { Box3, Heightmap, Rotation, StlLimits } from "@furrow/cam-core";

/**
 * Messages to and from the mesh worker (ADR-0004), which reads STL files and
 * draws models' previews off the main thread. `id` pairs a response with its
 * request.
 *
 * - `parse` reads and checks a picked file (PRD-0005 S1) and hashes it
 *   (ADR-0029); the worker keeps the mesh for previews.
 * - `preview` draws the mesh `sha256`, rotated, as seen from above
 *   (`modelHeightmap`). The worker answers `missing` when it doesn't hold the
 *   mesh; the request is then sent again with the file's `bytes`, which the
 *   worker checks against the hash.
 */
export type MeshRequest =
  | { kind: "parse"; id: number; bytes: ArrayBuffer; limits: StlLimits }
  | {
      kind: "preview";
      id: number;
      sha256: string;
      bounds: Box3;
      rotation: Rotation;
      bytes?: ArrayBuffer;
    };

/** What the document records of a mesh (ADR-0029). */
export type MeshSummary = { sha256: string; triangles: number; bounds: Box3 };

export type MeshResponse =
  | ({ kind: "parsed"; id: number } & MeshSummary)
  | { kind: "preview"; id: number; heightmap: Heightmap | null }
  | { kind: "missing"; id: number }
  /** `error` is for the user. */
  | { kind: "failed"; id: number; error: string };

/** The SHA-256 of `bytes` in lowercase hex, as the document stores it. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
