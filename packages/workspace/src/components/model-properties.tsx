"use client";

import { rotatedSize } from "@furrow/cam-core";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import {
  CircleAlertIcon,
  Maximize2Icon,
  RotateCwIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { ANCHOR_LABELS } from "../lib/anchor-grid";
import { originalSizeLabel } from "../lib/model-size";
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
  setModelDepth,
  setModelOffset,
  setModelScale,
  turnModelAbout,
} from "../stores/model-actions";

/** Keeps sizes and depths positive when stepping or scrubbing down. */
const MIN_LENGTH = 0.01;

const AXES = ["X", "Y", "Z"] as const;

/**
 * The selected model's placement on the stock (PRD-0005 S2, ADR-0031):
 * quarter turns, size (with the size in the file), depth and position from
 * the zero, each an undoable edit. Says that it is cut from the top only (S3).
 */
export function ModelProperties({ modelId }: { modelId: string }) {
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const model = useDocumentStore((s) => s.document.models.find(({ id }) => id === modelId));
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);
  const operationCount = useDocumentStore((s) => modelOperations(s.document, modelId).length);
  if (!model) return null;

  const { placement } = model;
  const [width, height, depth] = rotatedSize(model.bounds, placement.rotation);
  const offset = modelOffset(stock, model);
  const gestures = gestureHandlers(store);

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
          aria-label="Close model properties"
          title="Close"
        >
          <XIcon />
        </Button>
      </div>
      <p className="text-muted-foreground">
        {model.triangles.toLocaleString("en-US")} triangles. Cut from the top only: undercuts and
        overhangs are filled in, as the viewport shows.
      </p>

      <section aria-labelledby="model-rotation-heading" className="grid gap-2">
        <h3 id="model-rotation-heading" className="font-medium">
          Rotation
        </h3>
        <div className="flex gap-1">
          {AXES.map((axis, i) => (
            <Button
              key={axis}
              variant="outline"
              size="compact"
              onClick={() => turnModelAbout(store, model.id, i as 0 | 1 | 2)}
              title={`Turn 90° about the ${axis} axis`}
            >
              <RotateCwIcon />
              {axis}
            </Button>
          ))}
        </div>
      </section>

      <section aria-labelledby="model-size-heading" className="grid gap-2">
        <h3 id="model-size-heading" className="font-medium">
          Size
        </h3>
        {(
          [
            ["width", "Width", width],
            ["height", "Height", height],
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
          label="Depth"
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
            <span>
              The model reaches deeper than the stock is thick: it is cut no deeper than the stock's
              bottom.
            </span>
          </p>
        )}
        <p className="text-muted-foreground">{originalSizeLabel(model, units)}</p>
        <div className="flex justify-end gap-1">
          <Button
            variant="outline"
            size="compact"
            onClick={() => setModelScale(store, model.id, 1)}
            disabled={placement.scale === 1 && (depth === 0 || placement.depth === depth)}
            title="Scale the model back to its size in the file"
          >
            <Undo2Icon />
            Original size
          </Button>
          <Button variant="outline" size="compact" onClick={() => fitModelToStock(store, model.id)}>
            <Maximize2Icon />
            Fit to stock
          </Button>
        </div>
      </section>

      <section aria-labelledby="model-position-heading" className="grid gap-2">
        <h3 id="model-position-heading" className="font-medium">
          Position
        </h3>
        <p className="text-muted-foreground">
          The model's {ANCHOR_LABELS[modelAnchor(stock)].toLowerCase()} point, from the zero.
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
          title={
            operationCount > 0
              ? `Also removes the ${operationCount === 1 ? "operation" : `${operationCount} operations`} that machine it`
              : undefined
          }
        >
          <Trash2Icon />
          Remove model
        </Button>
      </div>
    </div>
  );
}
