"use client";

import { DEFAULT_SAFE_Z, formatQuantity, touchOffOutsideStock, unitLabel } from "@furrow/cam-core";
import { Units, ZOrigin } from "@furrow/document";
import { suggestTouchOffToolChange } from "@furrow/post";
import { CircleAlertIcon, CrosshairIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { useRef, useState } from "react";
import { NumberField } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { MachineChoice } from "@/features/machines/server";
import {
  ANCHOR_GRID,
  ANCHOR_LABELS,
  type ZeroChoice,
  zeroChoiceInDirection,
} from "@/features/workspace/lib/anchor-grid";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "@/features/workspace/providers/workspace-stores";
import { gestureHandlers } from "@/features/workspace/stores/gesture-handlers";
import {
  machineKey,
  matchingMachineChoice,
  setMachine,
} from "@/features/workspace/stores/machine-actions";
import {
  addTouchOff,
  removeTouchOff,
  type StockDimension,
  setCustomOrigin,
  setCustomXYOrigin,
  setStockDimension,
  setTouchOffField,
  setTouchOffToolChange,
  setUnits,
  setXYAnchor,
  setZOrigin,
} from "@/features/workspace/stores/stock-actions";
import { cn } from "@/lib/utils";

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

/**
 * The project's machine, display units, stock size and zero point, shown
 * while nothing is selected. `machines` are the user's machine profiles.
 */
export function StockProperties({ machines }: { machines: MachineChoice[] }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);

  return (
    <div className="grid gap-4 p-3 text-ui">
      <MachineField machines={machines} />
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

/** Value of the machine select for a snapshot that matches none of the user's machines. */
const SNAPSHOT = "";

/**
 * The machine the project is for (PRD-0001 R19). Choosing one snapshots it
 * into the document (ADR-0003) as an undoable edit; choosing the same machine
 * again picks up changes made to it since.
 */
function MachineField({ machines }: { machines: MachineChoice[] }) {
  const store = useDocumentStoreApi();
  const machine = useDocumentStore((s) => s.document.machine);
  // Tells apart machines with identical settings, which the snapshot alone can't.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = machines.find((choice) => choice.id === chosenId);
  const current =
    chosen && machine && machineKey(chosen.machine) === machineKey(machine)
      ? chosen
      : matchingMachineChoice(machines, machine);

  function choose(id: string) {
    const choice = machines.find((m) => m.id === id);
    if (!choice) return;
    setChosenId(id);
    setMachine(store, choice.machine);
  }

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
        <Label htmlFor="machine" className="text-ui font-normal">
          Machine
        </Label>
        <NativeSelect
          id="machine"
          size="sm"
          value={current?.id ?? SNAPSHOT}
          onChange={(event) => choose(event.target.value)}
          disabled={machines.length === 0 && machine === null}
          className="h-control w-full px-2 pr-7 text-ui"
        >
          <NativeSelectOption value={SNAPSHOT} disabled>
            {machine === null
              ? "Choose a machine…"
              : // Edited or deleted since it was snapshotted: the project keeps its copy.
                `${machine.name} (project copy)`}
          </NativeSelectOption>
          {machines.map((choice) => (
            <NativeSelectOption key={choice.id} value={choice.id}>
              {choice.machine.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {machine === null && (
        <p role="status" className="flex gap-1.5 text-destructive">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            No machine set. Choose the machine this project is for to export G-code.
            {machines.length === 0 && (
              <>
                {" "}
                <Link href="/machines/new" className="underline">
                  Add a machine
                </Link>
                .
              </>
            )}
          </span>
        </p>
      )}
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
      {zOrigin === "stock_top" && <TouchOffFields />}
    </section>
  );
}

/**
 * The touch-off pad (#147, ADR-0041, ADR-0043): a spot of the stock top no operation
 * cuts, for zeroing Z on after a tool change. Only with Z zeroed on the
 * stock top.
 */
function TouchOffFields() {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);
  const pad = stock.touchOff;
  const [refused, setRefused] = useState<number | null>(null);
  const widest = Math.min(stock.width, stock.height);

  return (
    <>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
        <input
          type="checkbox"
          id="touch-off"
          checked={pad !== null}
          onChange={(event) => (event.target.checked ? addTouchOff(store) : removeTouchOff(store))}
          aria-describedby="touch-off-hint"
          className="size-3.5 accent-primary"
        />
        <Label htmlFor="touch-off" className="text-ui font-normal">
          Touch-off pad
        </Label>
        <p id="touch-off-hint" className="col-start-2 text-muted-foreground">
          A spot of the stock top no operation cuts, so Z can be zeroed on it after a tool change.
        </p>
      </div>
      {pad && (
        <>
          {(["x", "y"] as const).map((axis) => (
            <NumberField
              key={axis}
              id={`touch-off-${axis}`}
              label={`Pad ${axis.toUpperCase()}`}
              layout="inline"
              quantity="length"
              units={units}
              value={pad[axis]}
              onValueChange={(value) => setTouchOffField(store, axis, value)}
              {...gestureHandlers(store)}
            />
          ))}
          <NumberField
            id="touch-off-diameter"
            label="Pad diameter"
            layout="inline"
            quantity="length"
            units={units}
            min={MIN_STOCK}
            value={pad.diameter}
            onValueChange={(diameter) =>
              setRefused(setTouchOffField(store, "diameter", diameter) ? null : diameter)
            }
            error={
              refused === null
                ? undefined
                : `Must fit on the stock: at most ${formatQuantity(widest, "length", units)} ${unitLabel("length", units)}`
            }
            {...gestureHandlers(store)}
          />
          <p className="text-muted-foreground">
            Its centre, from the stock's bottom-left corner. Resizing it keeps the centre where it
            is.
          </p>
          {touchOffOutsideStock(stock, pad) && (
            <p role="alert" className="flex gap-1.5 text-destructive">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              Part of the pad is off the stock, so there may be nothing to zero Z on there.
            </p>
          )}
          <TouchOffToolChange toolChange={pad.toolChange} />
        </>
      )}
    </>
  );
}

/**
 * The pad's own tool change (ADR-0043), in place of the machine's: edited as
 * text, saved as one undo step when the field loses focus (Escape reverts).
 * **Suggest** starts it from the machine's block with its move put on the
 * pad, every other command kept.
 */
function TouchOffToolChange({ toolChange }: { toolChange: string | null }) {
  const store = useDocumentStoreApi();
  const machine = useDocumentStore((s) => s.document.machine);
  /** What's typed while editing; `null` shows the saved block. */
  const [draft, setDraft] = useState<string | null>(null);
  const machineBlock = machine?.toolChange ?? null;

  function save() {
    if (draft !== null && draft !== (toolChange ?? "")) setTouchOffToolChange(store, draft);
    setDraft(null);
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="touch-off-tool-change" className="text-ui font-normal">
        Tool change on the pad
      </Label>
      <Textarea
        id="touch-off-tool-change"
        value={draft ?? toolChange ?? ""}
        placeholder={machineBlock ?? "M5\nM0 (Change the bit)"}
        rows={5}
        maxLength={10_000}
        spellCheck={false}
        className="font-mono text-xs md:text-xs"
        aria-describedby="touch-off-tool-change-hint"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(null);
          }
        }}
      />
      <p id="touch-off-tool-change-hint" className="text-muted-foreground">
        Empty, the program moves over the pad, then runs the machine's tool change. Filled in, this
        replaces both; <code>{"{padX}"}</code> and <code>{"{padY}"}</code> stand for the pad's
        centre, measured from the zero.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="compact"
          onClick={() => {
            setDraft(null);
            setTouchOffToolChange(
              store,
              suggestTouchOffToolChange(machineBlock, machine?.safeZ ?? DEFAULT_SAFE_Z),
            );
          }}
        >
          Suggest
        </Button>
        {toolChange !== null && (
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={() => {
              setDraft(null);
              setTouchOffToolChange(store, null);
            }}
          >
            Use the machine's
          </Button>
        )}
      </div>
    </div>
  );
}
