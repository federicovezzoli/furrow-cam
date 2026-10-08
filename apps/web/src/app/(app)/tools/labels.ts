import type { CutDirection, ToolType } from "@furrow/document";

export const TOOL_TYPE_LABELS: Record<ToolType, string> = {
  flat_end_mill: "Flat end mill",
  ball_end_mill: "Ball end mill",
  v_bit: "V-bit",
  drill: "Drill",
};

export const CUT_DIRECTION_LABELS: Record<CutDirection, string> = {
  upcut: "Upcut",
  downcut: "Downcut",
  compression: "Compression",
};
