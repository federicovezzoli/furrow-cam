import type { Recorder } from "../recorder.ts";

/**
 * The services terrain calls, fetched live (`TERRAIN_HOSTS` in
 * `packages/workspace/src/lib/terrain-services.ts`): the map's data and the
 * search can change between runs.
 */
const SERVICES = /^https:\/\/(tiles\.openfreemap\.org|tiles\.mapterhorn\.com|photon\.komoot\.io)\//;

/**
 * Half the square's side, in pixels at the zoom the search lands on (12):
 * about 7.7 km across, so the summit's relief, at life size, fits the 50 mm
 * stock. And how far off the summit it is first drawn, to be dragged onto it.
 */
const HALF_SIDE = 290;
const OFF: readonly [number, number] = [-40, 15];

/**
 * V5 (PRD-0013): *Terrain from a map*. Pizzo Arera, a peak in the Bergamo
 * Alps, found by name, cut out as a square centred on its summit, previewed
 * in 3D, then roughed and finished as in V4.
 */
export default async function terrain(r: Recorder) {
  await r.allow(SERVICES);
  await r.openWorkspace();
  // The relief reads best in 3D: orbit from the start.
  await r.click("view-orbit");

  // The stock first: the terrain is made to fit it, 160 mm across within the 10 mm border.
  await r.click("tab-properties");
  await r.type("stock-width", "180");
  await r.type("stock-height", "180");
  await r.type("stock-thickness", "50");
  await r.click("tab-operations");
  await r.hold(0.3);

  await r.click("ribbon-terrain", { waitFor: "terrain-map-idle" });
  // Enter would pick a suggestion before there is one: End leaves the text as typed.
  await r.type("terrain-search-input", "Pizzo Arera", {
    press: "End",
    waitFor: "terrain-suggestion",
  });
  await r.hold(0.6);
  // Photon's first suggestion is the peak (a point: the map jumps to it at zoom 12, centred on
  // the summit). Live data can rank another place first: that stops the run.
  await r.expectText("terrain-suggestion", /^Pizzo AreraOltre il Colle/);
  await r.click("terrain-suggestion", { waitFor: "terrain-map-idle" });
  await r.hold(0.6);

  // A square drawn a little off the summit, then dragged onto it.
  await r.click("terrain-tool-square");
  const map = await r.moveTo("terrain-map", 0.6);
  const [cx, cy] = [map.x + map.width / 2, map.y + map.height / 2];
  await r.moveToPoint(cx + OFF[0] - HALF_SIDE, cy + OFF[1] - HALF_SIDE, 0.5);
  await r.drag(2 * HALF_SIDE, 2 * HALF_SIDE, 1.2);
  await r.hold(0.6);
  await r.moveToPoint(cx + OFF[0], cy + OFF[1], 0.5);
  await r.drag(-OFF[0], -OFF[1], 1);
  // A map of another size, or a search that frames the peak another way, draws another square.
  await r.expectText("terrain-area", /^Area: 7\.\d × 7\.\d km$/);
  await r.hold(0.8);

  // Step two: the relief in 3D, at life size to fit the stock, on a thicker base.
  await r.click("terrain-next", { waitFor: "terrain-preview-ready" });
  await r.hold(0.4);
  const preview = await r.moveTo("terrain-preview-ready", 0.5);
  await r.moveToPoint(preview.x + preview.width * 0.3, preview.y + preview.height * 0.7, 0.4);
  await r.drag(160, -40, 2);
  await r.hold(0.5);
  await r.type("terrain-exaggeration", "1", { waitFor: "terrain-preview-ready" });
  await r.hold(0.8);
  await r.type("terrain-base", "4", { waitFor: "terrain-preview-ready" });
  await r.hold(1);

  // The model, centred on the stock.
  await r.click("terrain-generate", { waitFor: "model-width" });
  await r.hold(0.6);
  await r.click("close-model");
  await r.hold(0.5);

  await r.click("add-relief_rough", { waitFor: "job-time" });
  await r.newBit({
    name: "8 mm roughing end mill",
    diameter: "8",
    fluteLength: "50",
    stepDown: "3",
  });
  await r.click("close-operation");
  await r.hold(1);

  await r.click("add-relief_finish", { waitFor: "job-time" });
  await r.newBit({ name: "4 mm ball nose", diameter: "4", fluteLength: "20", stepDown: "1" });
  await r.click("close-operation");
  await r.expectNoWarnings();
  await r.hold(1);

  // The toolpaths in 3D.
  const view = await r.moveTo("viewport", 0.6);
  await r.moveToPoint(view.x + view.width * 0.2, view.y + view.height * 0.8, 0.5);
  await r.drag(120, -30, 3);
  await r.hold(1.5);
  r.poster();
}
