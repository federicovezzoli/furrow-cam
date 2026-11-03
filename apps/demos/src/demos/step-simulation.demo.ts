import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Recorder } from "../recorder.ts";

/** The project V2 saved (PRD-0013 D7); `step` sorts, and so records, first. */
const project = join(import.meta.dirname, "../../output/step.furrow.zip");

/** Plays the side the simulator shows at full speed, the camera orbiting slowly meanwhile. */
async function playSide(r: Recorder, side: "top" | "bottom", seconds: number) {
  await r.click(`side-${side}`);
  await r.waitForWork("playback-ready");
  await r.click("play");
  const view = await r.moveTo("simulation", 0.5);
  await r.moveToPoint(view.x + view.width * 0.35, view.y + view.height * 0.6, 0.3);
  await r.drag(240, 0, seconds);
  await r.hold(1);
}

/**
 * V3 (PRD-0013): the two-sided windsurf board of V2 in the simulator, the
 * bottom side cut from the stock the top side left.
 */
export default async function stepSimulation(r: Recorder) {
  if (!existsSync(project)) throw new Error("Record the step demo first: pnpm demos step");
  await r.openWorkspace(project);
  await r.waitForWork("job-time");
  await r.hold(0.5);
  await r.click("simulate", { waitFor: "simulation" });
  await r.click("view-orbit");
  // The stock as it is cut, not the lines over it.
  await r.click("show-toolpaths");
  // 50 m of top side and 61 m of bottom side play in about 20 s and 24 s.
  await r.select("playback-speed", "100×");
  await playSide(r, "top", 20);
  await playSide(r, "bottom", 24);
  r.poster();
  await r.hold(1.5);
}
