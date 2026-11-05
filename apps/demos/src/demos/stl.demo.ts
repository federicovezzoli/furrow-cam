import { fileURLToPath } from "node:url";
import type { Recorder } from "../recorder.ts";

const terrain = fileURLToPath(new URL("../../fixtures/mountain-160x160.stl", import.meta.url));

/**
 * Creates a library bit from the operation's tool select. Tab, not Enter,
 * between fields: Enter in a field submits the form.
 */
async function newBit(
  r: Recorder,
  fields: { name: string; diameter: string; fluteLength: string; stepDown: string },
) {
  await r.select("operation-tool", "New bit…", { waitFor: "save-bit" });
  for (const [field, value] of Object.entries(fields)) {
    await r.type(field, value, { press: "Tab" });
  }
  await r.click("save-bit", { waitFor: "job-time" });
}

/**
 * V4 (PRD-0013): a 3D relief of a mountain from an STL terrain, roughed with
 * an 8 mm roughing end mill and finished with a 4 mm ball nose.
 */
export default async function stl(r: Recorder) {
  await r.openWorkspace();
  // The relief reads best in 3D: orbit from the start.
  await r.click("view-orbit");
  await r.hold(0.5);

  // The stock first, so the terrain (162 × 161 × 44 mm) arrives fitted with
  // the 10 mm border: about 160 mm square, cutting 43 mm into the 48 mm stock.
  await r.click("tab-properties");
  await r.type("stock-width", "180");
  await r.type("stock-height", "180");
  await r.type("stock-thickness", "48");
  await r.chooseFile("import-model", terrain);
  await r.waitForWork("model-width");
  await r.hold(1);
  await r.click("close-model");
  await r.click("fit-stock");
  await r.click("tab-operations");
  await r.hold(0.5);

  await r.click("add-relief_rough", { waitFor: "job-time" });
  await newBit(r, {
    name: "8 mm roughing end mill",
    diameter: "8",
    fluteLength: "50",
    stepDown: "3",
  });
  await r.click("close-operation");
  await r.hold(1);

  await r.click("add-relief_finish", { waitFor: "job-time" });
  await newBit(r, { name: "4 mm ball nose", diameter: "4", fluteLength: "20", stepDown: "1" });
  await r.click("close-operation");
  await r.expectNoWarnings();
  await r.hold(1);

  // The finished relief in 3D.
  const view = await r.moveTo("viewport", 0.6);
  await r.moveToPoint(view.x + view.width * 0.2, view.y + view.height * 0.8, 0.5);
  await r.drag(120, -30, 3);
  await r.hold(1.5);
  r.poster();
  // Then closer, to the ridges the ball nose left.
  await r.wheel(-18, 1.5);
  await r.hold(2);
}
