"use client";

import { touchOffOutsideStock } from "@furrow/cam-core";
import { FlipAxis, Units, ZOrigin } from "@furrow/document";
import { suggestTouchOffToolChange } from "@furrow/post";
import { useDialogs } from "@furrow/ui/components/dialogs";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { Label } from "@furrow/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { Textarea } from "@furrow/ui/components/ui/textarea";
import { cn } from "@furrow/ui/lib/utils";
import { CircleAlertIcon, CrosshairIcon } from "lucide-react";
import type * as React from "react";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useLength } from "../hooks/use-length";
import { ANCHOR_GRID, type ZeroChoice, zeroChoiceInDirection } from "../lib/anchor-grid";
import type { MachineChoice } from "../lib/workspace-host";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "../providers/workspace-stores";
import { gestureHandlers } from "../stores/gesture-handlers";
import { machineKey, matchingMachineChoice, setMachine } from "../stores/machine-actions";
import {
  addTouchOff,
  removeTouchOff,
  type StockDimension,
  setCustomOrigin,
  setCustomXYOrigin,
  setFlipAxis,
  setPartingDepth,
  setStockDimension,
  setTouchOffField,
  setTouchOffToolChange,
  setTwoSided,
  setUnits,
  setXYAnchor,
  setZOrigin,
} from "../stores/stock-actions";
import { PlaceholderList } from "./placeholder-list";

const DIMENSIONS = ["width", "height", "thickness"] as const satisfies StockDimension[];

/** Thinner than any stock worth cutting, and keeps the stock's sizes positive. */
const MIN_STOCK = 0.1;

/**
 * The project's machine, display units, stock size and zero point, shown
 * while nothing is selected. `machines` are the user's machine profiles.
 */
export function StockProperties({ machines }: { machines: MachineChoice[] }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);
  const t = useTranslations("Stock");

  return (
    <div className="grid gap-4 p-3 text-ui">
      <MachineField machines={machines} />
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
        <Label htmlFor="units" className="text-ui font-normal">
          {t("unitsLabel")}
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
              {t(`units.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <section aria-labelledby="stock-heading" className="grid gap-2">
        <h3 id="stock-heading" className="font-medium">
          {t("stock")}
        </h3>
        {DIMENSIONS.map((key) => (
          <NumberField
            key={key}
            id={`stock-${key}`}
            label={t(`dimensions.${key}`)}
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

      <TwoSidedSection />

      <ZeroSection />
    </div>
  );
}

/**
 * Two-sided machining (PRD-0011, ADR-0060): the axis the stock is turned
 * over about and the depth the sides part at. Turning it off moves the
 * bottom side's operations to the top side, once the user agrees.
 */
function TwoSidedSection() {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);
  const bottom = useDocumentStore(
    (s) => s.document.operations.filter((operation) => operation.stockSide === "bottom").length,
  );
  const { confirm } = useDialogs();
  const t = useTranslations("Stock");
  const { twoSided } = stock;

  async function toggle(on: boolean) {
    if (!on && bottom > 0 && !(await confirm(t("twoSidedOff", { count: bottom })))) return;
    setTwoSided(store, on);
  }

  return (
    <section aria-labelledby="two-sided-heading" className="grid gap-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
        <input
          type="checkbox"
          id="two-sided"
          checked={twoSided !== null}
          onChange={(event) => void toggle(event.target.checked)}
          aria-describedby="two-sided-hint"
          className="size-3.5 accent-primary"
        />
        <Label id="two-sided-heading" htmlFor="two-sided" className="text-ui font-medium">
          {t("twoSided")}
        </Label>
        <p id="two-sided-hint" className="col-start-2 text-muted-foreground">
          {t("twoSidedHint")}
        </p>
      </div>
      {twoSided && (
        <>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
            <Label htmlFor="flip-axis" className="text-ui font-normal">
              {t("flipAxis")}
            </Label>
            <NativeSelect
              id="flip-axis"
              size="sm"
              value={twoSided.flipAxis}
              onChange={(event) => setFlipAxis(store, FlipAxis.parse(event.target.value))}
              className="h-control px-2 pr-7 text-ui"
            >
              {FlipAxis.options.map((axis) => (
                <NativeSelectOption key={axis} value={axis}>
                  {axis.toUpperCase()}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <NumberField
            id="parting-depth"
            label={t("partingDepth")}
            layout="inline"
            quantity="length"
            units={units}
            // Within the stock, however thin.
            min={Math.min(MIN_STOCK, stock.thickness / 2)}
            max={stock.thickness - Math.min(MIN_STOCK, stock.thickness / 2)}
            value={twoSided.partingDepth}
            onValueChange={(value) => setPartingDepth(store, value)}
            {...gestureHandlers(store)}
          />
          <p className="text-muted-foreground">{t("partingDepthHint")}</p>
        </>
      )}
    </section>
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
  const t = useTranslations("Stock");
  const { navigation, account } = useWorkspaceHost();
  const { Link } = navigation;
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
          {t("machine")}
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
              ? t("chooseMachine")
              : // Edited or deleted since it was snapshotted: the project keeps its copy.
                t("projectCopy", { name: machine.name })}
          </NativeSelectOption>
          {machines.map((choice) => (
            <NativeSelectOption key={choice.id} value={choice.id}>
              {choice.machine.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {machine === null && account && (
        <p role="status" className="flex gap-1.5 text-muted-foreground">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {t.rich("guestMachine", {
              button: (chunks) => (
                <button
                  type="button"
                  onClick={() => account.prompt("machine")}
                  className="underline"
                >
                  {chunks}
                </button>
              ),
            })}
          </span>
        </p>
      )}
      {machine === null && !account && (
        <p role="status" className="flex gap-1.5 text-destructive">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {t("noMachine")}
            {machines.length === 0 && (
              <>
                {" "}
                {t.rich("addMachine", {
                  link: (chunks) => (
                    <Link to="new-machine" className="underline">
                      {chunks}
                    </Link>
                  ),
                })}
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
  const t = useTranslations("Stock");
  const anchors = useTranslations("Anchors");

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
        {t("zero")}
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
                  title={anchors(anchor)}
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
                    aria-label={anchors(anchor)}
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
            {t("custom")}
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
              {picking ? t("cancel") : t("pickInViewport")}
            </Button>
          </div>
          {picking && <p className="text-muted-foreground">{t("pickHint")}</p>}
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
              {t(`zOrigins.${option}`)}
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
  const t = useTranslations("Stock");
  const length = useLength(units);
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
          {t("touchOff")}
        </Label>
        <p id="touch-off-hint" className="col-start-2 text-muted-foreground">
          {t("touchOffHint")}
        </p>
      </div>
      {pad && (
        <>
          {(["x", "y"] as const).map((axis) => (
            <NumberField
              key={axis}
              id={`touch-off-${axis}`}
              label={t("padAxis", { axis: axis.toUpperCase() })}
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
            label={t("padDiameter")}
            layout="inline"
            quantity="length"
            units={units}
            min={MIN_STOCK}
            value={pad.diameter}
            onValueChange={(diameter) =>
              setRefused(setTouchOffField(store, "diameter", diameter) ? null : diameter)
            }
            error={refused === null ? undefined : t("padTooWide", { size: length(widest) })}
            {...gestureHandlers(store)}
          />
          <p className="text-muted-foreground">{t("padCentre")}</p>
          {touchOffOutsideStock(stock, pad) && (
            <p role="alert" className="flex gap-1.5 text-destructive">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              {t("padOff")}
            </p>
          )}
          <TouchOffToolChange toolChange={pad.toolChange} />
        </>
      )}
    </>
  );
}

/**
 * The pad's tool change (ADR-0043, ADR-0056): the block the post writes, the
 * project's own or, without one, the one derived from the machine's. Edited
 * as text, saved as the project's own as one undo step when the field loses
 * focus (Escape reverts); **Reset** goes back to the derived one.
 */
function TouchOffToolChange({ toolChange }: { toolChange: string | null }) {
  const store = useDocumentStoreApi();
  const machineBlock = useDocumentStore((s) => s.document.machine?.toolChange ?? null);
  /** What's typed while editing; `null` shows the block that runs. */
  const [draft, setDraft] = useState<string | null>(null);
  const block = toolChange ?? suggestTouchOffToolChange(machineBlock);
  const t = useTranslations("Stock");

  function save() {
    if (draft !== null && draft !== block) setTouchOffToolChange(store, draft);
    setDraft(null);
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="touch-off-tool-change" className="text-ui font-normal">
        {t("padToolChange")}
      </Label>
      <Textarea
        id="touch-off-tool-change"
        value={draft ?? block}
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
        {t("padToolChangeHint")} <PlaceholderList />
      </p>
      {toolChange !== null && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={() => {
              setDraft(null);
              setTouchOffToolChange(store, null);
            }}
          >
            {t("reset")}
          </Button>
        </div>
      )}
    </div>
  );
}
