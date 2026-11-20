"use client";

import { flattenPath, MIN_LENGTH, patternPaths } from "@furrow/cam-core";
import { LINE_PATTERN_CELLS, type Path, PatternCell, type PatternSettings } from "@furrow/document";
import { useDialogs } from "@furrow/ui/components/dialogs";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { cn } from "@furrow/ui/lib/utils";
import { HexagonIcon, ShapesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useSelectionTargets } from "../hooks/use-selection-targets";
import { useSettledGestures } from "../hooks/use-settled-gestures";
import { shapePaths } from "../lib/path-selection";
import {
  addPattern,
  convertPattern,
  editPattern,
  type PatternEdits,
  patternSettled,
} from "../lib/pattern-items";
import { boundaryCorner, DEFAULT_PATTERN } from "../lib/patterns";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { drawingShapes } from "../stores/geometry-actions";
import { patternBoundary } from "../stores/pattern-actions";
import { Checkbox } from "./checkbox";
import { RibbonButton } from "./ribbon";

/** Cell types whose lines have a wave's or a zigzag's shape. */
const WAVY: readonly PatternCell[] = ["wave", "zigzag"];

/** Cell types drawn from a seed. */
const SEEDED: readonly PatternCell[] = ["truchet", "voronoi"];

/**
 * Fills the selected closed paths of one drawing with a pattern (PRD-0016 P1)
 * and selects it so its properties open, from the ribbon. Off, with the
 * reason in its tooltip, when the selection has none.
 */
export function FillPatternButton() {
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const geometry = useDocumentStore((s) => s.document.geometry);
  const drawings = useDocumentStore((s) => s.document.drawings);
  const targets = useSelectionTargets();
  const [adding, setAdding] = useState(false);
  const { alert } = useDialogs();
  const t = useTranslations("Pattern");
  const format = useFormatMessage();
  const bound = useMemo(
    () => patternBoundary({ geometry, drawings }, targets),
    [geometry, drawings, targets],
  );

  async function fill() {
    setAdding(true);
    const result = await addPattern(store, targets, t("defaultName")).finally(() =>
      setAdding(false),
    );
    // Said once: the selection may well fill with other settings or paths.
    if (!result.ok) return alert(format(result.error));
    const [shape] = drawingShapes(store.getState().document.geometry, result.id);
    if (shape) workspace.getState().selectPaths(shapePaths(shape));
  }

  return (
    <RibbonButton
      icon={<HexagonIcon />}
      label={t("fill")}
      hint={t("fillHint")}
      data-tour="fill-pattern"
      disabledReason={adding ? t("filling") : bound.ok ? undefined : format(bound.error)}
      onClick={() => void fill()}
    />
  );
}

/**
 * A pattern's settings (PRD-0016 P5): its cell type, picked from thumbnails,
 * its cells' size, the gap between them, the inset from its boundary, a
 * wave's shape, a random pattern's seed, its rotation and its origin's offset
 * from the boundary's corner. Each edit is generated again off the main
 * thread, previewed while a field is scrubbed, and lands as one undo step
 * keeping the operations machining it.
 */
export function PatternProperties({
  drawingId,
  pattern,
}: {
  drawingId: string;
  pattern: PatternSettings;
}) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const geometry = useDocumentStore((s) => s.document.geometry);
  const [error, setError] = useState<Translatable | null>(null);
  const [removedTabs, setRemovedTabs] = useState(0);
  const t = useTranslations("Pattern");
  const format = useFormatMessage();
  const { gestures, pending } = useSettledGestures(() => patternSettled(drawingId));
  const corner = useMemo(
    () => boundaryCorner(geometry, pattern.boundary),
    [geometry, pattern.boundary],
  );

  async function edit(edits: PatternEdits) {
    if (pending.current) await pending.current;
    const result = await editPattern(store, drawingId, edits);
    setError(result.ok ? null : result.error);
    if (result.ok) setRemovedTabs(result.removedTabs);
  }
  const length = (
    key: "size" | "gap" | "inset" | "amplitude" | "wavelength",
    min: number,
    disabled = false,
  ) => (
    <NumberField
      disabled={disabled}
      id={`pattern-${key}`}
      label={t(key)}
      layout="inline"
      quantity="length"
      units={units}
      min={min}
      value={pattern[key]}
      onValueChange={(value) => void edit({ [key]: value })}
      {...gestures}
    />
  );

  return (
    <section
      aria-labelledby="pattern-heading"
      className="grid gap-2"
      data-tour="pattern-properties"
    >
      <h3 id="pattern-heading" className="font-medium">
        {t("heading")}
      </h3>
      <p className="text-muted-foreground">{t("followsBoundary")}</p>
      <fieldset className="grid grid-cols-6 gap-1">
        <legend className="sr-only">{t("cell")}</legend>
        {PatternCell.options.map((cell) => (
          <label
            key={cell}
            title={t(`cells.${cell}`)}
            className={cn(
              "aspect-square cursor-pointer rounded-sm border p-0.5 text-muted-foreground hover:bg-accent",
              "has-checked:border-primary has-checked:bg-accent has-checked:text-foreground",
              "has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
            )}
          >
            <input
              type="radio"
              name={`pattern-cell-${drawingId}`}
              aria-label={t(`cells.${cell}`)}
              checked={pattern.cell === cell}
              onChange={() => void edit({ cell })}
              className="sr-only"
            />
            <CellThumbnail cell={cell} />
          </label>
        ))}
      </fieldset>
      <p className="text-muted-foreground">{t(`cells.${pattern.cell}`)}</p>
      {length("size", MIN_LENGTH)}
      {/* Lines have no walls between cells. */}
      {length("gap", 0, LINE_PATTERN_CELLS.includes(pattern.cell))}
      {length("inset", 0)}
      {WAVY.includes(pattern.cell) && length("amplitude", MIN_LENGTH)}
      {WAVY.includes(pattern.cell) && length("wavelength", MIN_LENGTH)}
      {SEEDED.includes(pattern.cell) && (
        <NumberField
          id="pattern-seed"
          label={t("seed")}
          layout="inline"
          quantity="number"
          min={0}
          step={1}
          value={pattern.seed}
          onValueChange={(seed) => void edit({ seed: Math.round(seed) })}
          {...gestures}
        />
      )}
      <NumberField
        id="pattern-rotation"
        label={t("rotation")}
        layout="inline"
        quantity="number"
        suffix="°"
        value={pattern.placement.rotation}
        onValueChange={(degrees) => void edit({ rotation: ((degrees % 360) + 360) % 360 })}
        {...gestures}
      />
      <Checkbox
        id="pattern-mirrored"
        label={t("mirrored")}
        checked={pattern.placement.mirrored}
        onChange={(mirrored) => void edit({ mirrored })}
      />
      {(["x", "y"] as const).map((axis, i) => (
        <NumberField
          key={axis}
          id={`pattern-offset-${axis}`}
          label={t(`offset.${axis}`)}
          layout="inline"
          quantity="length"
          units={units}
          value={(pattern.placement.position[i] as number) - (corner[i] as number)}
          onValueChange={(value) => void edit({ [axis]: (corner[i] as number) + value })}
          {...gestures}
        />
      ))}
      {removedTabs > 0 && (
        <p role="status" className="text-muted-foreground">
          {t("tabsRemoved", { count: removedTabs })}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="compact"
          onClick={async () => {
            const result = await convertPattern(store, drawingId);
            if (!result.ok) setError(result.error);
          }}
          title={t("convertTitle")}
        >
          <ShapesIcon />
          {t("convert")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {format(error)}
        </p>
      )}
    </section>
  );
}

/** The side of the square a thumbnail fills, in millimetres. */
const THUMBNAIL = 24;

/** Each cell type's thumbnail paths, generated the first time it is drawn. */
const thumbnails = new Map<PatternCell, string>();

/** `cell`'s cells filling a square, at the default settings but a smaller size. */
function CellThumbnail({ cell }: { cell: PatternCell }) {
  let d = thumbnails.get(cell);
  if (d === undefined) {
    const square: Path = {
      start: [0, 0],
      segments: [
        { kind: "line", to: [THUMBNAIL, 0] },
        { kind: "line", to: [THUMBNAIL, THUMBNAIL] },
        { kind: "line", to: [0, THUMBNAIL] },
      ],
      closed: true,
    };
    const paths = patternPaths([square], {
      ...DEFAULT_PATTERN,
      cell,
      size: 8,
      amplitude: 3,
      wavelength: 8,
      placement: { position: [0, 0], rotation: 0, mirrored: false },
      boundary: [],
    });
    d = paths
      .map((path) => {
        const points = flattenPath(path, 0.1).map(([x, y]) => `${x.toFixed(2)} ${THUMBNAIL - y}`);
        return `M${points.join("L")}${path.closed ? "Z" : ""}`;
      })
      .join("");
    thumbnails.set(cell, d);
  }
  return (
    <svg viewBox={`0 0 ${THUMBNAIL} ${THUMBNAIL}`} className="size-full" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={0.6} />
    </svg>
  );
}
