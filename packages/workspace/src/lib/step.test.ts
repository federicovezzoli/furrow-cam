import { DEFAULT_STL_LIMITS, parseStl } from "@furrow/cam-core";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url&inline";
import { describe, expect, it } from "vitest";
import boxWithHole from "./fixtures/box-with-hole.step?raw";
import boxWithHoleInch from "./fixtures/box-with-hole-inch.step?raw";
import { isStepFile, OCCT_LICENCES, stepToStl } from "./step";

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
    expect(OCCT_LICENCES.map((url) => url.pathname.split("/").pop())).toEqual([
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

describe("stepToStl", () => {
  it("turns a solid into a closed STL mesh in millimetres", async () => {
    const mesh = parseStl(await stepToStl(bytes(boxWithHole), DEFAULT_STL_LIMITS, wasm));
    expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [40, 20, 10] });
    // The 40 x 20 x 10 mm box less its 10 mm hole, within 0.5% for the hole's facets.
    const solid = 40 * 20 * 10 - Math.PI * 5 ** 2 * 10;
    expect(Math.abs(volume(mesh.positions) - solid)).toBeLessThan(solid * 0.005);
  }, 30_000);

  it("converts a file in inches", async () => {
    const mesh = parseStl(await stepToStl(bytes(boxWithHoleInch), DEFAULT_STL_LIMITS, wasm));
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
