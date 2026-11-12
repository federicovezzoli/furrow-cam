import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Recorder } from "../recorder.ts";

/** The project V2 saved (PRD-0013 D7); `step` sorts, and so records, first (`main.ts`). */
const project = join(import.meta.dirname, "../../output/step.furrow.zip");

/** Millimetres of path played each second at 100× (`PLAYBACK_MM_PER_SECOND` × 100). */
const SPEED = 2500;

/** Plays `side` to its end at 100×, the camera orbiting slowly meanwhile. */
async function playSide(r: Recorder, side: "top" | "bottom") {
  await r.click(`side-${side}`);
  await r.waitForWork("playback-ready");
  const length = Number(await (await r.anchor("playback-position")).getAttribute("max"));
  await r.click("play");
  const view = await r.moveTo("simulation", 0.5);
  await r.moveToPoint(view.x + view.width * 0.35, view.y + view.height * 0.6, 0.3);
  await r.drag(240, 0, length / SPEED);
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
  await r.click("parting-plane");
  await r.select("playback-speed", "100×");
  // 50 m of top side and 61 m of bottom side: about 20 s and 24 s.
  await playSide(r, "top");
  await playSide(r, "bottom");
  r.poster();
  await r.hold(1.5);
}
