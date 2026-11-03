import { fileURLToPath } from "node:url";
import type { Recorder } from "../recorder.ts";

const paw = fileURLToPath(new URL("../../fixtures/dog-paw.svg", import.meta.url));

/**
 * Where the paw's paths are drawn, in pixels from the viewport's top left
 * corner, once the 160 × 80 mm stock is fitted in the top view with the zero
 * middle left. Measured on a recorded frame: a click within 6 px of a line picks it.
 */
const PATHS = {
  outline: [264, 260],
  toes: [
    [213, 376],
    [332, 376],
    [142, 448],
    [505, 448],
  ],
  pad: [329, 489],
  // Bare stock: a click there clears the selection.
  empty: [1200, 760],
} as const;

/** V1 (PRD-0013): a 2D job from an SVG of a dog paw, with a line of text. */
export default async function svg(r: Recorder) {
  await r.openWorkspace();
  await r.hold(0.5);
  await r.chooseFile("start-import-drawing", paw);
  await r.hold(1);

  // Stock and zero.
  await r.click("tab-properties");
  await r.type("stock-width", "160");
  await r.type("stock-height", "80");
  await r.click("zero-middle_left");
  await r.click("fit-stock");
  await r.click("tab-operations");
  await r.hold(0.5);

  // A profile around the paw, with holding tabs.
  await r.clickIn("viewport", PATHS.outline);
  await r.expectSelected(1);
  await r.click("add-profile", { waitFor: "job-time" });
  await r.click("profile-tabs", { waitFor: "job-time" });
  await r.click("close-operation");
  await r.hold(1);

  // A pocket for the pads.
  await r.clickIn("viewport", PATHS.pad);
  for (const toe of PATHS.toes) await r.clickIn("viewport", toe, { shift: true });
  await r.expectSelected(5);
  await r.click("add-pocket", { waitFor: "job-time" });
  // Small enough for the gaps between the toes.
  await r.select("operation-tool", "3 mm 2-flute upcut", { waitFor: "job-time" });
  await r.click("close-operation");
  await r.hold(1);

  // A line of text, V-carved.
  await r.click("add-text");
  await r.type("text-text", "WOOF!", { press: "ControlOrMeta+Enter" });
  await r.type("drawing-x", "72");
  await r.click("add-vcarve", { waitFor: "job-time" });
  // Letters this size need no more than 3 mm, within the 90° bit's flutes.
  await r.type("vcarve-max-depth", "3", { waitFor: "job-time" });
  await r.expectNoWarnings();
  await r.click("close-operation");
  await r.clickIn("viewport", PATHS.empty);
  await r.hold(1);

  // The toolpaths in 3D.
  await r.click("view-orbit");
  const view = await r.moveTo("viewport", 0.6);
  await r.moveToPoint(view.x + view.width * 0.15, view.y + view.height * 0.85, 0.5);
  await r.drag(100, -20, 3);
  await r.hold(1.5);
  r.poster();

  // Export: without an account, the workspace explains what G-code needs (#469).
  await r.click("export-gcode");
  await r.hold(3);
}
