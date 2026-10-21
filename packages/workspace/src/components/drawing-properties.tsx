"use client";

import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { localizeDecimal } from "@furrow/ui/lib/locales";
import { Maximize2Icon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { cappedBorder } from "../lib/model-size";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import {
  drawingBounds,
  drawingOperations,
  fitDrawingToStock,
  removeDrawing,
  setDrawingBorder,
  setDrawingSize,
} from "../stores/geometry-actions";
import { gestureHandlers } from "../stores/gesture-handlers";
import type { ActionResult } from "../stores/operation-actions";

/** Keeps sizes positive when stepping or scrubbing down. */
const MIN_LENGTH = 0.01;

/**
 * The selected drawing's size (PRD-0009 D2, D3, ADR-0055): width and height,
 * which keep its proportions, the border *Fit to stock* leaves, and removing
 * it, each an undoable edit.
 */
export function DrawingProperties({ drawingId }: { drawingId: string }) {
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const drawing = useDocumentStore((s) => s.document.drawings.find(({ id }) => id === drawingId));
  const bounds = useDocumentStore((s) => drawingBounds(s.document, drawingId));
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);
  const operationCount = useDocumentStore((s) => drawingOperations(s.document, drawingId).length);
  /** Why the last size change was refused, and on which field. */
  const [error, setError] = useState<{ field: string; message: Translatable } | null>(null);
  const t = useTranslations("Drawing");
  const format = useFormatMessage();
  const locale = useLocale();
  if (!drawing || !bounds) return null;

  const gestures = gestureHandlers(store);
  const capped = cappedBorder(drawing.border, stock, units);
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
        <NumberField
          id="drawing-border"
          label={t("border")}
          layout="inline"
          quantity="length"
          units={units}
          min={0}
          value={drawing.border}
          onValueChange={(value) => setDrawingBorder(store, drawing.id, value)}
          {...gestures}
        />
        <p className="text-muted-foreground">
          {capped === null
            ? t("borderNote")
            : t("borderCapped", { size: localizeDecimal(capped, locale) })}
        </p>
        <div className="flex justify-end">
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
        {error?.field === "fit" && (
          <p role="alert" className="text-destructive">
            {format(error.message)}
          </p>
        )}
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
