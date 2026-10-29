// The setup a program's header tells the user about: where to zero, where the
// touch-off pad is and, in a two-sided project, how to turn the stock over.
import { edgeSetup, stockOffset } from "@furrow/cam-core";
import {
  type Stock,
  type StockAnchor,
  stockPins,
  type Tool,
  type TouchOff,
} from "@furrow/document";
import { formatNumber } from "./format";
import type { SideSetup } from "./post";
import { toolLabel } from "./tool";

/** Where the touch-off pad is, in work coordinates, and how wide. */
export function padLabel(stock: Stock, { x, y, diameter }: TouchOff): string {
  const [ox, oy] = stockOffset(stock);
  return `X${formatNumber(x + ox)} Y${formatNumber(y + oy)}, ${formatNumber(diameter)} mm across`;
}

const ANCHOR_LABELS = {
  bottom_left: "at the bottom-left corner",
  bottom_center: "at the middle of the bottom edge",
  bottom_right: "at the bottom-right corner",
  middle_left: "at the middle of the left edge",
  center: "at the centre",
  middle_right: "at the middle of the right edge",
  top_left: "at the top-left corner",
  top_center: "at the middle of the top edge",
  top_right: "at the top-right corner",
} as const satisfies Record<StockAnchor, string>;

export function xyZeroLabel({ xyOrigin: origin }: Stock): string {
  if (origin.anchor !== "custom") return `${ANCHOR_LABELS[origin.anchor]} of the stock`;
  return (
    `at X${formatNumber(origin.x)} Y${formatNumber(origin.y)} mm ` +
    "from the stock's bottom-left corner"
  );
}

export function zZeroLabel({ zOrigin }: Stock): string {
  return zOrigin === "stock_top" ? "at the stock top" : "at the machine bed";
}

/**
 * What to do before and after one side of a two-sided project (ADR-0060):
 * the bottom side runs once the stock is turned over in place, about its
 * centre line along the flip axis, and is zeroed as the top side was, on
 * the face now on top.
 */
export function sideSetupLines(
  stock: Stock,
  { side, other, pins: drilled }: SideSetup,
  firstTool: Tool | undefined,
): string[] {
  const { twoSided, zOrigin } = stock;
  const axis = (twoSided?.flipAxis ?? "x").toUpperCase();
  const pins = drilled ? stockPins(stock) : null;
  const edges = edgeSetup(stock);
  // As each side sees it: turned over, another corner of the stock lies there.
  const corner = edges && `the stock's corner at the ${edges.corner.replace("_", "-")}`;
  // Pins on the centre line hold it in place (#356), once the top side drilled them;
  // a fence corner keeps its footprint (#361).
  const onto = pins
    ? `onto its ${pins.positions.length} locating pins of ${formatNumber(pins.diameter)} mm`
    : edges
      ? "back into the same fence corner"
      : "in place";
  const flip = `turn the stock over by half a turn about its centre line along ${axis}, ${onto}`;
  const fence = edges
    ? [
        `Line up: push ${corner}, as it lies, into the fence corner, ` +
          `the XY zero at X${formatNumber(edges.offset[0])} Y${formatNumber(edges.offset[1])} mm from it`,
      ]
    : [];
  // Files aren't named: G-code comments can't hold the parentheses names may have.
  if (side === "top") {
    return [
      "Two-sided: top side, cut first",
      // Without a bottom side's file the stock is never turned over.
      ...(other ? [...fence, `Then ${flip}, and run the bottom side's file`] : []),
    ];
  }
  const z = zOrigin === "stock_top" ? "Z on the face now on top" : "Z still at the machine bed";
  return [
    "Two-sided: bottom side, cut second",
    ...(other ? ["Run the top side's file first"] : []),
    `Before this file, ${flip}, so the face that was underneath is on top`,
    ...fence,
    ...(edges
      ? [
          `The sides only meet if the stock is ${formatNumber(edges.measure.size)} mm ` +
            `along ${edges.measure.axis.toUpperCase()}: measure it`,
        ]
      : []),
    // The top side's file may have ended with another bit.
    ...(firstTool ? [`Load ${toolLabel(firstTool)}`] : []),
    // Zeroing XY again on the turned-over stock would throw the fence corner away.
    edges ? `Keep the top side's XY zero, and set ${z}` : `Zero as for the top side, ${z}`,
  ];
}
