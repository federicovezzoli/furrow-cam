import type {
  Box3,
  Heightmap,
  LonLat,
  Rotation,
  StlLimits,
  Terrain,
  TerrainSettings,
} from "@furrow/cam-core";
import type { Message } from "@furrow/document";

/**
 * Messages to and from the mesh worker (ADR-0004), which reads STL files and
 * draws models' previews off the main thread. `id` pairs a response with its
 * request.
 *
 * - `parse` reads and checks a picked file (PRD-0005 S1) and hashes it
 *   (ADR-0029); the worker keeps the mesh for previews. A STEP file is first
 *   turned into an STL, sent back as `stl` to be stored instead (ADR-0072).
 * - `preview` draws the mesh `sha256`, rotated, as seen from above
 *   (`modelHeightmap`). The worker answers `missing` when it doesn't hold the
 *   mesh; the request is then sent again with the file's `bytes`, which the
 *   worker checks against the hash.
 * - `terrain` fetches the elevation for the area `ring` and builds its mesh
 *   (PRD-0014, ADR-0077), reporting `terrainProgress` as tiles arrive; the
 *   STL comes back as `stl`, to be stored like an imported one.
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
    }
  | {
      kind: "terrain";
      id: number;
      ring: LonLat[];
      settings: TerrainSettings;
      limits: StlLimits;
    };

/** What the document records of a mesh (ADR-0029). */
export type MeshSummary = { sha256: string; triangles: number; bounds: Box3 };

/** A terrain built in the worker, its STL as a buffer to transfer. */
export type GeneratedTerrain = MeshSummary &
  Omit<Terrain, "stl" | "triangles"> & { stl: ArrayBuffer };

export type MeshResponse =
  | ({ kind: "parsed"; id: number; stl?: ArrayBuffer } & MeshSummary)
  | { kind: "preview"; id: number; heightmap: Heightmap | null }
  | { kind: "missing"; id: number }
  /** `done` of `total` tile requests known so far. */
  | { kind: "terrainProgress"; id: number; done: number; total: number }
  | ({ kind: "terrain"; id: number } & GeneratedTerrain)
  /** `error` is for the user. */
  | { kind: "failed"; id: number; error: Message };

/** The SHA-256 of `bytes` in lowercase hex, as the document stores it. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
