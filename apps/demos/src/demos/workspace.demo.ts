import type { Recorder } from "../recorder.ts";

/** The trivial demo: an empty workspace, its 3D view orbited (ADR-0075). */
export default async function workspace(r: Recorder) {
  await r.openWorkspace();
  await r.hold(0.5);
  await r.click("view-orbit");
  await r.hold(0.5);
  const view = await r.moveTo("viewport", 0.8);
  // Start on open canvas: the empty-project card in the middle catches drags.
  await r.moveToPoint(view.x + view.width * 0.2, view.y + view.height * 0.75, 0.5);
  await r.drag(600, 30, 2.5);
  await r.hold(1);
}
