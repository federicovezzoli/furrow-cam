"use client";

import { Units, ZOrigin } from "@furrow/document";
import { cn } from "cn";
import { CrosshairIcon } from "lucide-react";
import type * as React from "react";
import { useRef } from "react";
import { NumberField } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  ANCHOR_GRID,
  ANCHOR_LABELS,
  type ZeroChoice,
  zeroChoiceInDirection,
} from "@/lib/anchor-grid";
import { gestureHandlers } from "@/stores/gesture-handlers";
import {
  type StockDimension,
  setCustomOrigin,
  setCustomXYOrigin,
  setStockDimension,
  setUnits,
  setXYAnchor,
  setZOrigin,
} from "@/stores/stock-actions";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "@/stores/workspace-stores";

const UNIT_LABELS: Record<Units, string> = { mm: "Millimetres", in: "Inches" };

const DIMENSIONS = [
  ["width", "Width"],
  ["height", "Height"],
  ["thickness", "Thickness"],
] as const satisfies [StockDimension, string][];

/** Thinner than any stock worth cutting, and keeps the stock's sizes positive. */
const MIN_STOCK = 0.1;

const Z_ORIGIN_LABELS: Record<ZOrigin, string> = {
  stock_top: "Stock top",
  machine_bed: "Machine bed",
};

/** The project's display units, stock size and zero point, shown while nothing is selected. */
export function StockProperties() {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);

  return (
    <div className="grid gap-4 p-3 text-ui">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
        <Label htmlFor="units" className="text-ui font-normal">
          Units
        </Label>
        <NativeSelect
          id="units"
          size="sm"
          value={units}
          onChange={(event) => setUnits(store, Units.parse(event.target.value))}
          className="h-control px-2 pr-7 text-ui"
        >
          {Units.options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {UNIT_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <section aria-labelledby="stock-heading" className="grid gap-2">
        <h3 id="stock-heading" className="font-medium">
          Stock
        </h3>
        {DIMENSIONS.map(([key, label]) => (
          <NumberField
            key={key}
            id={`stock-${key}`}
            label={label}
            layout="inline"
            quantity="length"
            units={units}
            min={MIN_STOCK}
            value={stock[key]}
            onValueChange={(value) => setStockDimension(store, key, value)}
            {...gestureHandlers(store)}
          />
        ))}
      </section>

      <ZeroSection />
    </div>
  );
}

/**
 * Where the machine is zeroed (PRD-0002 Z2, Z4, Z5, Z10): a stock anchor or
 * a custom XY point, typed or picked in the viewport, and the Z zero. The viewport's marker and grid follow it.
 */
function ZeroSection() {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const xyOrigin = useDocumentStore((s) => s.document.stock.xyOrigin);
  const zOrigin = useDocumentStore((s) => s.document.stock.zOrigin);
  const radios = useRef(new Map<ZeroChoice, HTMLInputElement>());
  const picking = useWorkspaceStore((s) => s.pickingZero);
  const setPicking = useWorkspaceStore((s) => s.setPickingZero);

  function choose(choice: ZeroChoice) {
    if (choice === "custom") setCustomXYOrigin(store);
    else setXYAnchor(store, choice);
  }

  /**
   * Arrow keys move around the grid as laid out, rather than through the
   * radios in order; chords (Alt+Arrow for back/forward, …) are left alone.
   */
  function onKeyDown(choice: ZeroChoice, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next = zeroChoiceInDirection(choice, event.key);
    if (next === null) return;
    event.preventDefault();
    choose(next);
    radios.current.get(next)?.focus();
  }

  /** Keeps `radios` up to date as the inputs mount and unmount. */
  function radioRef(choice: ZeroChoice) {
    return (input: HTMLInputElement | null) => {
      if (input) radios.current.set(choice, input);
      else radios.current.delete(choice);
    };
  }

  return (
    <section aria-labelledby="zero-heading" className="grid gap-2">
      <h3 id="zero-heading" className="font-medium">
        Zero
      </h3>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-x-2">
        <span id="zero-xy-label" className="py-1">
          XY
        </span>
        <div
          role="radiogroup"
          aria-labelledby="zero-xy-label"
          className="grid justify-items-start gap-2"
        >
          {/* The stock as seen in the top view, with a point on each anchor. */}
          <div className="grid h-16 w-24 grid-cols-3 grid-rows-3 rounded-sm border bg-muted/50">
            {ANCHOR_GRID.flatMap((row, r) =>
              row.map((anchor, c) => (
                <label
                  key={anchor}
                  title={ANCHOR_LABELS[anchor]}
                  className={cn(
                    "flex cursor-pointer p-0.5",
                    ["items-start", "items-center", "items-end"][r],
                    ["justify-start", "justify-center", "justify-end"][c],
                  )}
                >
                  <input
                    ref={radioRef(anchor)}
                    type="radio"
                    name="zero-xy"
                    aria-label={ANCHOR_LABELS[anchor]}
                    checked={xyOrigin.anchor === anchor}
                    onChange={() => choose(anchor)}
                    onKeyDown={(event) => onKeyDown(anchor, event)}
                    className="peer sr-only"
                  />
                  <span className="size-3 rounded-full border border-muted-foreground bg-background transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 hover:border-foreground" />
                </label>
              )),
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="zero-xy"
              ref={radioRef("custom")}
              checked={xyOrigin.anchor === "custom"}
              onChange={() => choose("custom")}
              onKeyDown={(event) => onKeyDown("custom", event)}
              className="accent-primary"
            />
            Custom
          </label>
        </div>
      </div>
      {xyOrigin.anchor === "custom" && (
        <>
          {(["x", "y"] as const).map((axis) => (
            <NumberField
              key={axis}
              id={`zero-${axis}`}
              label={axis.toUpperCase()}
              layout="inline"
              quantity="length"
              units={units}
              value={xyOrigin[axis]}
              onValueChange={(value) => setCustomOrigin(store, axis, value)}
              {...gestureHandlers(store)}
            />
          ))}
          <div className="flex justify-end">
            <Button
              variant={picking ? "secondary" : "outline"}
              size="compact"
              aria-pressed={picking}
              onClick={() => setPicking(!picking)}
            >
              <CrosshairIcon />
              {picking ? "Cancel" : "Pick in viewport"}
            </Button>
          </div>
          {picking && (
            <p className="text-muted-foreground">
              Click a point in the viewport; it snaps to stock anchors, vertices, centres and
              bounding boxes nearby. Esc or right-click cancels.
            </p>
          )}
        </>
      )}
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
        <Label htmlFor="zero-z" className="text-ui font-normal">
          Z
        </Label>
        <NativeSelect
          id="zero-z"
          size="sm"
          value={zOrigin}
          onChange={(event) => setZOrigin(store, ZOrigin.parse(event.target.value))}
          className="h-control px-2 pr-7 text-ui"
        >
          {ZOrigin.options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {Z_ORIGIN_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </section>
  );
}
