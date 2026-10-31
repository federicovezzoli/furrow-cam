"use client";

import { MIN_LENGTH, rotatedSize } from "@furrow/cam-core";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { localizeDecimal } from "@furrow/ui/lib/locales";
import {
  CircleAlertIcon,
  Maximize2Icon,
  RotateCwIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "use-intl";
import { cappedBorder, originalSize } from "../lib/model-size";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { gestureHandlers } from "../stores/gesture-handlers";
import {
  fitModelToStock,
  modelAnchor,
  modelOffset,
  modelOperations,
  removeModel,
  setModelBorder,
  setModelDepth,
  setModelOffset,
  setModelScale,
  turnModelAbout,
} from "../stores/model-actions";

const AXES = ["X", "Y", "Z"] as const;

/**
 * The selected model's placement on the stock (PRD-0005 S2, ADR-0031):
 * quarter turns, size (with the size in the file), depth, the border *Fit to
 * stock* leaves and position from the zero, each an undoable edit. Says that
 * it is cut from the top only (S3).
 */
export function ModelProperties({ modelId }: { modelId: string }) {
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const model = useDocumentStore((s) => s.document.models.find(({ id }) => id === modelId));
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);
  const operationCount = useDocumentStore((s) => modelOperations(s.document, modelId).length);
  const t = useTranslations("Model");
  const locale = useLocale();
  if (!model) return null;

  const { placement } = model;
  const [width, height, depth] = rotatedSize(model.bounds, placement.rotation);
  const offset = modelOffset(stock, model);
  const gestures = gestureHandlers(store);
  const original = originalSize(model, units);
  const capped = cappedBorder(model.border, stock, units);

  return (
    <div className="grid gap-4 p-3 text-ui">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium" title={model.fileName}>
          {model.fileName}
        </h3>
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={() => workspace.getState().selectModel(null)}
          aria-label={t("closeLabel")}
          title={t("close")}
        >
          <XIcon />
        </Button>
      </div>
      <p className="text-muted-foreground">{t("triangles", { count: model.triangles })}</p>

      <section aria-labelledby="model-rotation-heading" className="grid gap-2">
        <h3 id="model-rotation-heading" className="font-medium">
          {t("rotation")}
        </h3>
        <div className="flex gap-1">
          {AXES.map((axis, i) => (
            <Button
              key={axis}
              variant="outline"
              size="compact"
              onClick={() => turnModelAbout(store, model.id, i as 0 | 1 | 2)}
              title={t("turn", { axis })}
            >
              <RotateCwIcon />
              {axis}
            </Button>
          ))}
        </div>
      </section>

      <section aria-labelledby="model-size-heading" className="grid gap-2">
        <h3 id="model-size-heading" className="font-medium">
          {t("size")}
        </h3>
        {(
          [
            ["width", t("width"), width],
            ["height", t("height"), height],
          ] as const
        ).map(([key, label, extent]) => (
          <NumberField
            key={key}
            id={`model-${key}`}
            label={label}
            layout="inline"
            quantity="length"
            units={units}
            min={MIN_LENGTH}
            value={extent > 0 ? extent * placement.scale : null}
            disabled={extent === 0}
            // The same scale both ways, so the model keeps its outline.
            onValueChange={(value) => setModelScale(store, model.id, value / extent)}
            {...gestures}
          />
        ))}
        <NumberField
          id="model-depth"
          label={t("depth")}
          layout="inline"
          quantity="length"
          units={units}
          min={MIN_LENGTH}
          value={depth > 0 ? placement.depth : null}
          disabled={depth === 0}
          onValueChange={(value) => setModelDepth(store, model.id, value)}
          {...gestures}
        />
        {depth > 0 && placement.depth > stock.thickness && (
          <p role="status" className="flex gap-1.5 text-destructive">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t("tooDeep")}</span>
          </p>
        )}
        <p className="text-muted-foreground">
          {t("original", {
            size: localizeDecimal(original.size, locale),
            scale: original.scale,
          })}
        </p>
        <NumberField
          id="model-border"
          label={t("border")}
          layout="inline"
          quantity="length"
          units={units}
          min={0}
          value={model.border}
          onValueChange={(value) => setModelBorder(store, model.id, value)}
          {...gestures}
        />
        <p className="text-muted-foreground">
          {capped === null
            ? t("borderNote")
            : t("borderCapped", { size: localizeDecimal(capped, locale) })}
        </p>
        <div className="flex justify-end gap-1">
          <Button
            variant="outline"
            size="compact"
            onClick={() => setModelScale(store, model.id, 1)}
            disabled={placement.scale === 1 && (depth === 0 || placement.depth === depth)}
            title={t("originalTitle")}
          >
            <Undo2Icon />
            {t("originalSize")}
          </Button>
          <Button
            variant="outline"
            size="compact"
            onClick={() => fitModelToStock(store, model.id)}
            title={t("fitTitle")}
          >
            <Maximize2Icon />
            {t("fit")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="model-position-heading" className="grid gap-2">
        <h3 id="model-position-heading" className="font-medium">
          {t("position")}
        </h3>
        <p className="text-muted-foreground">
          {t.rich("positionHint", {
            anchor: modelAnchor(stock),
            em: (chunks) => <em>{chunks}</em>,
          })}
        </p>
        {(["x", "y"] as const).map((axis, i) => (
          <NumberField
            key={axis}
            id={`model-${axis}`}
            label={axis.toUpperCase()}
            layout="inline"
            quantity="length"
            units={units}
            value={offset[i] as number}
            onValueChange={(value) => setModelOffset(store, model.id, axis, value)}
            {...gestures}
          />
        ))}
      </section>

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="compact"
          onClick={() => removeModel(store, model.id)}
          title={operationCount > 0 ? t("removeTitle", { count: operationCount }) : undefined}
        >
          <Trash2Icon />
          {t("remove")}
        </Button>
      </div>
    </div>
  );
}
