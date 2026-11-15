"use client";

import { DRILL_DIAMETER_TOLERANCE, MIN_LENGTH, pinDepth } from "@furrow/cam-core";
import { type DrillOperation, stockPins } from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import { useTranslations } from "use-intl";
import { useLength } from "../../hooks/use-length";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "../../providers/workspace-stores";
import { gestureHandlers } from "../../stores/gesture-handlers";
import { updateDrillParams } from "../../stores/operation-actions";
import { Checkbox } from "../checkbox";
import { StepOverField, useParamsUpdate } from "./fields";

export function DrillFields({ operation }: { operation: DrillOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const thickness = useDocumentStore((s) => s.document.stock.thickness);
  const format = useFormatMessage();
  const pins = useDocumentStore((s) => stockPins(s.document.stock));
  const { params, tool } = operation;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updateDrillParams(store, operation.id, changes),
  );
  const t = useTranslations("Operation");
  const length = useLength(units);

  return (
    <section aria-labelledby="drill-heading" className="grid gap-2">
      <h4 id="drill-heading" className="font-medium">
        {t("drill")}
      </h4>
      <p className="text-muted-foreground">
        {t("drillHint", {
          tolerance: length(DRILL_DIAMETER_TOLERANCE),
          bore: tool.type === "drill" ? "no" : "yes",
        })}
      </p>
      {params.pins ? (
        <p>
          {pins
            ? t("pinDepth", { depth: length(pinDepth(thickness, pins)) })
            : format({ code: "toolpath.noLocatingPins" })}
        </p>
      ) : (
        <NumberField
          id="drill-depth"
          label={t("depth")}
          min={MIN_LENGTH}
          value={params.depth}
          onValueChange={(depth) => update("depth", { depth })}
          error={errors.depth}
          layout="inline"
          quantity="length"
          units={units}
          {...gestureHandlers(store)}
        />
      )}
      <Checkbox
        id="drill-peck"
        label={t("peck")}
        hint={t("peckHint")}
        checked={params.peck}
        onChange={(peck) => update("peck", { peck })}
      />
      {tool.type !== "drill" && (
        <StepOverField
          id="drill-step-over"
          tool={tool}
          value={params.stepOver}
          error={errors.stepOver}
          onValueChange={(stepOver) => update("stepOver", { stepOver })}
        />
      )}
      {errors.peck && (
        <p role="alert" className="text-destructive">
          {errors.peck}
        </p>
      )}
      {!params.pins && <HolesFields count={params.points.length} />}
    </section>
  );
}

/** How many holes a drill has placed (#429), and a toggle for placing them in the viewport. */
function HolesFields({ count }: { count: number }) {
  const t = useTranslations("Operation");
  const editing = useWorkspaceStore((s) => s.editing === "holes");
  const setEditing = useWorkspaceStore((s) => s.setEditing);
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-muted-foreground">{t("holeCount", { count })}</span>
        <Button
          variant={editing ? "secondary" : "outline"}
          size="compact"
          aria-pressed={editing}
          onClick={() => setEditing(editing ? null : "holes")}
        >
          {editing ? t("done") : t("placeHoles")}
        </Button>
      </div>
      {editing && <p className="text-muted-foreground">{t("placeHolesHint")}</p>}
    </>
  );
}
