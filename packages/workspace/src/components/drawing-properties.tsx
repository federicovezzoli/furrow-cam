"use client";

import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { localizeDecimal } from "@furrow/ui/lib/locales";
import {
  CircleAlertIcon,
  FlipHorizontal2Icon,
  FlipVertical2Icon,
  Maximize2Icon,
  RotateCcwIcon,
  RotateCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { cappedBorder } from "../lib/model-size";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import {
  drawingBounds,
  drawingOffset,
  drawingOperations,
  fitDrawingToStock,
  mirrorDrawing,
  removeDrawing,
  rotateDrawing,
  setDrawingBorder,
  setDrawingOffset,
  setDrawingSize,
} from "../stores/geometry-actions";
import { gestureHandlers } from "../stores/gesture-handlers";
import { modelAnchor } from "../stores/model-actions";
import type { ActionResult } from "../stores/operation-actions";

/** Keeps sizes positive when stepping or scrubbing down. */
const MIN_LENGTH = 0.01;

/** The angle the rotate field starts at, in degrees. */
const DEFAULT_ANGLE = 15;

/**
 * The selected drawing's size and position (PRD-0009 D2, D3, D5, ADR-0055):
 * width and height, which keep its proportions, the border *Fit to stock*
 * leaves, mirroring and turning it (D6, D7), its position from the zero, and
 * removing it, each an undoable edit.
 */
export function DrawingProperties({ drawingId }: { drawingId: string }) {
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const drawing = useDocumentStore((s) => s.document.drawings.find(({ id }) => id === drawingId));
  const geometry = useDocumentStore((s) => s.document.geometry);
  // Computed here, not in the selector: a fresh box on every call would never settle.
  const bounds = useMemo(() => drawingBounds(geometry, drawingId), [geometry, drawingId]);
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);
  const operationCount = useDocumentStore((s) => drawingOperations(s.document, drawingId).length);
  /** Why the last size change was refused, and on which field. */
  const [error, setError] = useState<{ field: string; message: Translatable } | null>(null);
  /** The angle *Rotate* turns by, counter-clockwise for positive ones. */
  const [angle, setAngle] = useState(DEFAULT_ANGLE);
  const t = useTranslations("Drawing");
  const format = useFormatMessage();
  const locale = useLocale();
  if (!drawing || !bounds) return null;

  const gestures = gestureHandlers(store);
  const capped = cappedBorder(drawing.border, stock, units);
  const offset = drawingOffset(stock, bounds);
  // A nanometre of slack: fitted and imported drawings sit exactly on their box.
  const offStock =
    bounds.min[0] < -1e-6 ||
    bounds.min[1] < -1e-6 ||
    bounds.max[0] > stock.width + 1e-6 ||
    bounds.max[1] > stock.height + 1e-6;
  const apply = (field: string, result: ActionResult) =>
    setError(result.ok ? null : { field, message: result.error });

  return (
    <div className="grid gap-4 p-3 text-ui">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium" title={drawing.name}>
          {drawing.name || t("untitled")}
        </h3>
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={() => workspace.getState().selectPaths([])}
          aria-label={t("closeLabel")}
          title={t("close")}
        >
          <XIcon />
        </Button>
      </div>

      <section aria-labelledby="drawing-size-heading" className="grid gap-2">
        <h3 id="drawing-size-heading" className="font-medium">
          {t("size")}
        </h3>
        {(
          [
            ["width", t("width"), bounds.max[0] - bounds.min[0]],
            ["height", t("height"), bounds.max[1] - bounds.min[1]],
          ] as const
        ).map(([key, label, extent]) => (
          <NumberField
            key={key}
            id={`drawing-${key}`}
            label={label}
            layout="inline"
            quantity="length"
            units={units}
            min={MIN_LENGTH}
            value={extent > 0 ? extent : null}
            disabled={extent === 0}
            // The same scale both ways, so the drawing keeps its proportions.
            onValueChange={(value) => apply(key, setDrawingSize(store, drawing.id, key, value))}
            error={error?.field === key ? error.message : undefined}
            {...gestures}
          />
        ))}
        {/* The border is only *Fit to stock*'s margin: moving the drawing leaves it behind. */}
        <div className="flex items-end gap-1">
          <NumberField
            id="drawing-border"
            label={t("border")}
            layout="inline"
            quantity="length"
            units={units}
            min={0}
            value={drawing.border}
            onValueChange={(value) => setDrawingBorder(store, drawing.id, value)}
            className="flex-1"
            {...gestures}
          />
          <Button
            variant="outline"
            size="compact"
            onClick={() => apply("fit", fitDrawingToStock(store, drawing.id))}
            title={t("fitTitle")}
          >
            <Maximize2Icon />
            {t("fit")}
          </Button>
        </div>
        <p className="text-muted-foreground">
          {capped === null
            ? t("borderNote")
            : t("borderCapped", { size: localizeDecimal(capped, locale) })}
        </p>
        {error?.field === "fit" && (
          <p role="alert" className="text-destructive">
            {format(error.message)}
          </p>
        )}
      </section>

      <section aria-labelledby="drawing-orientation-heading" className="grid gap-2">
        <h3 id="drawing-orientation-heading" className="font-medium">
          {t("orientation")}
        </h3>
        <div className="flex flex-wrap gap-1">
          {(
            [
              // lucide names its flips by the axis drawn, not the way things flip.
              [t("mirrorX"), FlipVertical2Icon, () => mirrorDrawing(store, drawing.id, "x")],
              [t("mirrorY"), FlipHorizontal2Icon, () => mirrorDrawing(store, drawing.id, "y")],
              [t("rotateLeft"), RotateCcwIcon, () => rotateDrawing(store, drawing.id, 90)],
              [t("rotateRight"), RotateCwIcon, () => rotateDrawing(store, drawing.id, -90)],
            ] as const
          ).map(([label, Icon, action]) => (
            <Button
              key={label}
              variant="outline"
              size="icon-compact"
              onClick={() => apply("orientation", action())}
              aria-label={label}
              title={label}
            >
              <Icon />
            </Button>
          ))}
        </div>
        <div className="flex items-end gap-1">
          <NumberField
            id="drawing-angle"
            label={t("angle")}
            layout="inline"
            quantity="number"
            suffix="°"
            value={angle}
            onValueChange={setAngle}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="compact"
            onClick={() => apply("orientation", rotateDrawing(store, drawing.id, angle))}
            title={t("rotateTitle")}
          >
            {t("rotate")}
          </Button>
        </div>
        {error?.field === "orientation" && (
          <p role="alert" className="text-destructive">
            {format(error.message)}
          </p>
        )}
      </section>

      <section aria-labelledby="drawing-position-heading" className="grid gap-2">
        <h3 id="drawing-position-heading" className="font-medium">
          {t("position")}
        </h3>
        <p className="text-muted-foreground">{t("positionHint", { anchor: modelAnchor(stock) })}</p>
        {offStock && (
          <p role="status" className="flex gap-1.5 text-destructive">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t("offStock")}</span>
          </p>
        )}
        {(["x", "y"] as const).map((axis, i) => (
          <NumberField
            key={axis}
            id={`drawing-${axis}`}
            label={axis.toUpperCase()}
            layout="inline"
            quantity="length"
            units={units}
            value={offset[i] as number}
            onValueChange={(value) => setDrawingOffset(store, drawing.id, axis, value)}
            {...gestures}
          />
        ))}
      </section>

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="compact"
          onClick={() => removeDrawing(store, drawing.id)}
          title={operationCount > 0 ? t("removeTitle", { count: operationCount }) : undefined}
        >
          <Trash2Icon />
          {t("remove")}
        </Button>
      </div>
    </div>
  );
}
