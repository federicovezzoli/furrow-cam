import { circleCenter, DEFAULT_STL_LIMITS, modelFlatFaces, parseStl } from "@furrow/cam-core";
import type { ModelPlacement } from "@furrow/document";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url&inline";
import { describe, expect, it, vi } from "vitest";
import boxWithHole from "./fixtures/box-with-hole.step?raw";
import boxWithHoleInch from "./fixtures/box-with-hole-inch.step?raw";
import plate from "./fixtures/plate-2.5d.step?raw";
import { OCCT_LICENCES } from "./occt-licences";
import { faceSizes, isStepFile, stepToStl } from "./step";

const wasm = async () => (await fetch(wasmUrl)).arrayBuffer();
const bytes = (text: string) => new TextEncoder().encode(text);

/** The volume a closed mesh encloses, positive when its triangles face outwards. */
function volume(positions: Float32Array) {
  let sum = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const p = (k: number) => positions[i + k] as number;
    sum +=
      p(0) * (p(4) * p(8) - p(5) * p(7)) -
      p(1) * (p(3) * p(8) - p(5) * p(6)) +
      p(2) * (p(3) * p(7) - p(4) * p(6));
  }
  return sum / 6;
}

describe("OCCT_LICENCES", () => {
  it("ships occt-import-js's and OpenCascade's licences", () => {
    expect(OCCT_LICENCES.map(({ url }) => url.pathname.split("/").pop())).toEqual([
      "license.occt.txt",
      "license.occt-import-js.txt",
    ]);
  });
});

describe("isStepFile", () => {
  it("tells STEP files from STL files", () => {
    expect(isStepFile(bytes(boxWithHole))).toBe(true);
    expect(isStepFile(bytes("\n  ISO-10303-21;"))).toBe(true);
    expect(isStepFile(bytes("solid relief"))).toBe(false);
    expect(isStepFile(new Uint8Array())).toBe(false);
  });
});

describe("faceSizes", () => {
  const mesh = (triangles: number, brep_faces?: { first: number; last: number }[]) => ({
    index: { array: Array.from({ length: triangles * 3 }, () => 0) },
    ...(brep_faces && { brep_faces }),
  });

  it("counts each face's triangles, leaving out a face with none", () => {
    const faces = [
      { first: 0, last: 2 },
      { first: 3, last: 2 },
      { first: 3, last: 4 },
    ];
    expect(faceSizes(mesh(5, faces))).toEqual([3, 2]);
  });

  it("gives up unless the faces share out every triangle in order", () => {
    expect(
      faceSizes(
        mesh(5, [
          { first: 0, last: 1 },
          { first: 3, last: 4 },
        ]),
      ),
    ).toBeNull();
    expect(faceSizes(mesh(5, [{ first: 0, last: 3 }]))).toBeNull();
    expect(
      faceSizes(
        mesh(5, [
          { first: 2, last: 4 },
          { first: 0, last: 1 },
        ]),
      ),
    ).toBeNull();
    expect(faceSizes(mesh(5))).toBeNull();
  });
});

describe("stepToStl", () => {
  it("says STEP import couldn't be loaded when the kernel fails to load, and tries again", async () => {
    vi.resetModules();
    const step = await import("./step");
    const offline = () => Promise.reject(new TypeError("Failed to fetch"));
    await expect(
      step.stepToStl(bytes(boxWithHole), DEFAULT_STL_LIMITS, offline),
    ).rejects.toMatchObject({
      detail: { code: "workspace.stepImportUnavailable" },
    });
    const { stl } = await step.stepToStl(bytes(boxWithHole), DEFAULT_STL_LIMITS, wasm);
    expect(parseStl(stl).bounds.max).toEqual([40, 20, 10]);
  }, 30_000);

  it("turns a solid into a closed STL mesh in millimetres", async () => {
    const mesh = parseStl((await stepToStl(bytes(boxWithHole), DEFAULT_STL_LIMITS, wasm)).stl);
    expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [40, 20, 10] });
    // The 40 x 20 x 10 mm box less its 10 mm hole, within 0.5% for the hole's facets.
    const solid = 40 * 20 * 10 - Math.PI * 5 ** 2 * 10;
    expect(Math.abs(volume(mesh.positions) - solid)).toBeLessThan(solid * 0.005);
  }, 30_000);

  it("says how many of the STL's triangles each face of the solid was meshed into", async () => {
    const { stl, faces } = await stepToStl(bytes(boxWithHole), DEFAULT_STL_LIMITS, wasm);
    const mesh = parseStl(stl);
    // Six sides and the hole's wall.
    expect(faces).toHaveLength(7);
    expect(faces?.reduce((sum, count) => sum + count, 0)).toBe(mesh.triangles);
    const { levels, outline } = modelFlatFaces(mesh.positions, {
      bounds: mesh.bounds,
      placement: { rotation: [0, 0, 0], scale: 1, depth: 10, top: 0, position: [0, 0] },
      ...(faces && { faces }),
    });
    // The top, with its hole as a circle; the bottom faces down.
    expect(levels.map(({ z }) => z)).toEqual([0]);
    const holes = levels[0]?.paths.map((path) => circleCenter(path)).filter(Boolean);
    expect(holes).toEqual([[20, 10]]);
    expect(outline).toHaveLength(1);
  }, 30_000);

  it("finds the levels, holes and outline of a 2.5D part, with its faces or without", async () => {
    // 100 x 60 x 12 mm: a pocket 6 mm deep, a step 3 mm deep and four 6 mm through holes.
    const { stl, faces } = await stepToStl(bytes(plate), DEFAULT_STL_LIMITS, wasm);
    const mesh = parseStl(stl);
    const placement: ModelPlacement = {
      rotation: [0, 0, 0],
      scale: 1,
      depth: 12,
      top: 0,
      position: [0, 0],
    };
    for (const model of [
      { bounds: mesh.bounds, placement, ...(faces && { faces }) },
      { bounds: mesh.bounds, placement },
    ]) {
      const { levels, outline } = modelFlatFaces(mesh.positions, model);
      expect(levels.map(({ z, paths }) => [z, paths.length])).toEqual([
        [0, 7],
        [-3, 1],
        [-6, 1],
      ]);
      const holes = levels[0]?.paths.map((path) => circleCenter(path)).filter((c) => c !== null);
      expect(holes?.map((point) => point.map((v) => Math.round(v * 100) / 100))).toEqual(
        expect.arrayContaining([
          [6, 6],
          [94, 6],
          [6, 54],
          [94, 54],
        ]),
      );
      expect(holes).toHaveLength(4);
      expect(outline).toHaveLength(1);
    }
  }, 30_000);

  it("converts a file in inches", async () => {
    const { stl } = await stepToStl(bytes(boxWithHoleInch), DEFAULT_STL_LIMITS, wasm);
    const mesh = parseStl(stl);
    expect(mesh.bounds.max.map((v) => Math.round(v * 1000) / 1000)).toEqual([50.8, 25.4, 12.7]);
  }, 30_000);

  it("refuses a file it can't read", async () => {
    await expect(
      stepToStl(bytes("ISO-10303-21;\nnonsense"), DEFAULT_STL_LIMITS, wasm),
    ).rejects.toMatchObject({
      detail: { code: "workspace.stepUnreadable" },
    });
  });

  it("refuses a file with no solids", async () => {
    // The box's shape replaced by one of its edges' lines: wireframe only.
    const wireframe = boxWithHole
      .replace(
        /ADVANCED_BREP_SHAPE_REPRESENTATION\('',\(#\d+\)/,
        "GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('',(#9999)",
      )
      .replace("ENDSEC;\nEND-ISO", "#9999=GEOMETRIC_CURVE_SET('',(#33));\nENDSEC;\nEND-ISO");
    await expect(stepToStl(bytes(wireframe), DEFAULT_STL_LIMITS, wasm)).rejects.toMatchObject({
      detail: { code: "workspace.stepNoSolids" },
    });
  });

  it("refuses a mesh the STL limits wouldn't take, by triangles or by stored size", async () => {
    const few = { maxBytes: DEFAULT_STL_LIMITS.maxBytes, maxTriangles: 10 };
    await expect(stepToStl(bytes(boxWithHole), few, wasm)).rejects.toMatchObject({
      detail: { code: "stl.tooManyTriangles", values: { max: 10 } },
    });
    const small = { maxBytes: 84 + 50 * 20, maxTriangles: DEFAULT_STL_LIMITS.maxTriangles };
    await expect(stepToStl(bytes(boxWithHole), small, wasm)).rejects.toMatchObject({
      detail: { code: "stl.tooManyTriangles", values: { max: 20 } },
    });
  });
});
