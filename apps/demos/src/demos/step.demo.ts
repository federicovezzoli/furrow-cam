import { fileURLToPath } from "node:url";
import type { Recorder } from "../recorder.ts";

const board = fileURLToPath(new URL("../../fixtures/tavola3.step", import.meta.url));

/**
 * Roughing then finishing on the side the viewport shows; each operation goes
 * on that side. Each also cuts a margin round the board down to the parting
 * plane, so no band of stock is left along the rails.
 */
async function cutSide(r: Recorder, side: "top" | "bottom") {
  await r.click(`side-${side}`);
  for (const operation of ["relief_rough", "relief_finish"]) {
    await r.click(`add-${operation}`, { waitFor: "job-time" });
    await r.select(`${operation.replace("_", "-")}-boundary`, "Model and margin", {
      waitFor: "job-time",
    });
    await r.click("close-operation");
  }
  await r.hold(1);
}

/**
 * V2 (PRD-0013): a two-sided 3D job from a STEP model of a windsurf board,
 * saved as a project file for V3 (D7).
 */
export default async function step(r: Recorder) {
  await r.openWorkspace();
  await r.hold(0.5);
  await r.chooseFile("import-model", board);
  await r.waitForWork("model-width");
  await r.hold(1);

  // A model of the board, no thicker than the bits cut (22 mm), with room at the ends for the pins.
  await r.click("tab-properties");
  await r.type("stock-width", "240");
  await r.type("stock-height", "100");
  await r.type("stock-thickness", "22");
  await r.type("model-border", "30");
  await r.click("fit-model");
  await r.click("close-model");
  await r.click("fit-stock");

  // Two-sided (PRD-0011 B1), lined up on pins (B4) and held by tabs (B5).
  await r.click("two-sided");
  await r.select("line-up", "Locating pins");
  // Out past the board's ends (±90 mm), where no cut reaches them.
  await r.type("pin-0", "-110");
  await r.type("pin-1", "110");
  await r.click("holding-tabs");
  await r.click("tab-operations");
  await r.hold(1);

  await cutSide(r, "top");
  await cutSide(r, "bottom");

  // Both sides in 3D.
  await r.click("view-orbit");
  const view = await r.moveTo("viewport", 0.6);
  await r.moveToPoint(view.x + view.width * 0.15, view.y + view.height * 0.85, 0.5);
  await r.drag(100, -20, 3);
  await r.hold(1.5);
  r.poster();

  // The project file V3 opens, then G-code: without an account, the workspace explains what it needs (#469).
  await r.click("tab-properties");
  await r.saveDownload("export-project");
  await r.click("tab-operations");
  await r.click("export-gcode");
  await r.hold(3);
}
