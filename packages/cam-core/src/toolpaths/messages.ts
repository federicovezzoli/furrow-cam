import type { DocumentMessage, Message } from "@furrow/document";

/**
 * What toolpaths warn about (ADR-0054): problems that didn't stop the
 * toolpath, such as paths it had to skip. Counts are in `count`.
 */
export const TOOLPATH_MESSAGES = [
  "toolpath.skippedPoints",
  "toolpath.skippedOpenProfile",
  "toolpath.skippedOpenPocket",
  "toolpath.skippedOpenVCarve",
  "toolpath.skippedSmallCircles",
  "toolpath.skippedLargeCircles",
  "toolpath.skippedNonCircles",
  "toolpath.depthExceedsFlutes",
  "toolpath.flatDepthExceedsFlutes",
  "toolpath.vcarveConeLimit",
  "toolpath.vcarveEdgesUncarved",
  "toolpath.flatAreasNarrow",
  "toolpath.engraveConeWide",
  "toolpath.pathsTooSmall",
  "toolpath.tabsTooTall",
  "toolpath.tabsLeftOut",
  "toolpath.leadInMisfits",
  "toolpath.peelIsland",
  "toolpath.touchOffPad",
  "toolpath.modelMissing",
  "toolpath.noLocatingPins",
  "toolpath.pinsOffStock",
  "toolpath.noArea",
  "toolpath.belowStock",
  "toolpath.coarsened",
  "toolpath.restCoarsened",
  "toolpath.roughNothing",
  "toolpath.roughMarginOffStock",
  "toolpath.restOperationFailed",
] as const;

export type ToolpathMessageCode = (typeof TOOLPATH_MESSAGES)[number];

/** A toolpath warning: the toolpath's own, or the document's when its tool can't cut. */
export type ToolpathMessage = Message<ToolpathMessageCode> | DocumentMessage;
