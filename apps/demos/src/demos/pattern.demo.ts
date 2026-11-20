import { fileURLToPath } from "node:url";
import { PLAYBACK_100X, type Recorder } from "../recorder.ts";

const sign = fileURLToPath(new URL("../../fixtures/sign.svg", import.meta.url));

/**
 * Where the sign's paths are drawn, in pixels from the viewport's top left
 * corner, once the 220 × 140 mm stock is fitted in the top view with the zero
 * bottom left. Measured on a recorded frame: a click within 6 px of a line picks it.
 */
const PATHS = {
  // The left edges of the frame's outline and of its inner outline.
  outline: [207, 538],
  inner: [267, 538],
  // Off the stock, below it: a click there clears the selection.
  empty: [1300, 935],
} as const;

/** The cells shown in the picker before the pattern settles on honeycomb, the one carved. */
const CELLS = ["voronoi", "wave", "fishScale", "hexagon"];

/**
 * V6 (PRD-0013): a sign's inside filled with a pattern (PRD-0016), its cells
 * V-carved and its outline cut out, then the sign resized with the pattern
 * following it, and the job carved in the simulation.
 */
export default async function pattern(r: Recorder) {
  await r.openWorkspace();
  await r.hold(0.5);
  await r.chooseFile("import-drawing", sign);
  await r.hold(1);

  // Stock and zero.
  await r.click("tab-properties");
  await r.type("stock-width", "220");
  await r.type("stock-height", "140");
  await r.click("zero-bottom_left");
  await r.click("fit-stock");
  await r.click("tab-operations");
  await r.hold(0.5);

  // The inner outline, filled with hexagons; the frame around it stays empty.
  await r.clickIn("viewport", PATHS.inner, { alt: true });
  await r.expectSelected(1);
  await r.click("fill-pattern", { waitFor: "pattern-properties" });
  await r.hold(1.5);

  // A few cells, then the honeycomb's size, gap and turn. The recorder waits
  // for each edit's cells before the next frame, a scrub's included.
  for (const cell of CELLS) {
    await r.click(`pattern-cell-${cell}`);
    await r.hold(1.2);
  }
  // 6 mm cells with 2 mm walls: narrow enough for the V-bit to carve to a point 3 mm deep.
  await r.scrub("pattern-size", -4, 1);
  await r.scrub("pattern-gap", 1, 0.5);
  await r.scrub("pattern-rotation", 15, 1.5);
  await r.hold(1);

  // Each cell V-carved, leaving sharp walls between them. A pocket would leave
  // slivers along the boundary too narrow for its end mill.
  await r.click("add-vcarve", { waitFor: "job-time" });
  // Within the 90° bit's flutes.
  await r.type("vcarve-max-depth", "3", { waitFor: "job-time" });
  await r.expectNoWarnings();
  await r.click("close-operation");
  await r.hold(0.5);

  // The sign cut out, with holding tabs.
  await r.clickIn("viewport", PATHS.outline, { alt: true });
  await r.expectSelected(1);
  await r.click("add-profile", { waitFor: "job-time" });
  await r.click("profile-tabs", { waitFor: "job-time" });
  await r.click("close-operation");
  await r.hold(1);

  // A larger sign: the pattern fills the new inside, its cells their size,
  // and the V-carve and the profile follow.
  await r.clickIn("viewport", PATHS.outline);
  // Kept clear of the panel over the viewport's right side.
  await r.type("drawing-width", "180", { waitFor: "job-time" });
  await r.expectNoWarnings();
  // The moment that sets a pattern apart from an imported tile: give it time.
  await r.hold(4);
  await r.clickIn("viewport", PATHS.empty);
  await r.hold(0.5);

  // The sign carved in the simulation, the camera orbiting meanwhile: a
  // dense pattern's toolpaths read as a tangle, the carved stock doesn't.
  await r.click("simulate", { waitFor: "simulation" });
  await r.click("view-orbit");
  await r.click("show-toolpaths");
  await r.select("playback-speed", "100×");
  await r.waitForWork("playback-ready");
  const length = Number(await (await r.anchor("playback-position")).getAttribute("max"));
  await r.click("play");
  const view = await r.moveTo("simulation", 0.5);
  await r.moveToPoint(view.x + view.width * 0.35, view.y + view.height * 0.6, 0.3);
  await r.drag(200, 0, length / PLAYBACK_100X);
  await r.hold(0.5);
  // Then closer, to the honeycomb's walls.
  await r.wheel(-10, 1.5);
  await r.hold(1);
  r.poster();
  await r.hold(1.5);
}
