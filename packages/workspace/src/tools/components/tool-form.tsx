"use client";

import { type Tool, ToolType } from "@furrow/document";
import { FormError } from "@furrow/ui/components/form-error";
import { Field, FieldError, fieldProps, SelectField } from "@furrow/ui/components/form-fields";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { Label } from "@furrow/ui/components/ui/label";
import { Textarea } from "@furrow/ui/components/ui/textarea";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { type FormEvent, useState, useTransition } from "react";
import { useTranslations } from "use-intl";
import type { SavedTool, ToolFormErrors } from "../../lib/workspace-host";
import { BitTypeIcon } from "./bit-type-icon";
import { useToolDialogBusy } from "./tool-dialog";

/** Starting values for a new tool; the rest of the fields start empty. */
const NEW_TOOL: Partial<Tool> = {
  type: "flat_end_mill",
  fluteCount: 2,
  cutDirection: "upcut",
  spindleRpm: 24000,
  feedRate: 600,
  plungeRate: 300,
  plungeAngle: 3,
  stepDown: 1,
  stepOver: 40,
};

/** Saves the form's fields as tool `id`, or a new tool when `null`. */
export type SaveTool = (
  id: string | null,
  form: FormData,
) => Promise<{ errors: ToolFormErrors } | SavedTool>;

type ToolFormProps = {
  /** The tool to edit, or `null` to create one. */
  id: string | null;
  values: Partial<Tool>;
  save: SaveTool;
  /** Called with the saved tool's id and the tool, as an operation snapshot. */
  onSaved: (saved: SavedTool) => void;
  onCancel: () => void;
};

/**
 * Edits the tool `id`, or creates one when `id` is `null`, starting from
 * `NEW_TOOL` plus `values`, through `save`. Shown in a dialog, so saving never
 * leaves the page.
 */
export function ToolForm({ id, values, save, onSaved, onCancel }: ToolFormProps) {
  const tool = id === null ? { ...NEW_TOOL, ...values } : values;
  const [type, setType] = useState<ToolType>(tool.type ?? "flat_end_mill");
  const t = useTranslations("Bit");
  const [errors, setErrors] = useState<ToolFormErrors>({});
  const [pending, startTransition] = useTransition();
  useToolDialogBusy(pending);
  const isEndMill = type === "flat_end_mill" || type === "ball_end_mill";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      // Staying on the page, so a failure must not fall into the error boundary.
      const result = await save(id, form).catch(() => ({
        errors: { form: t("saveFailed") },
      }));
      if ("errors" in result) setErrors(result.errors);
      else onSaved(result);
    });
  }

  const field = fieldProps(tool, errors);
  const number = fieldProps(tool, errors, null);

  return (
    <form onSubmit={onSubmit} className="grid gap-8" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TypePicker value={type} onChange={setType} error={errors.type} />
        <Field label={t("name")} {...field("name")} placeholder={t("namePlaceholder")} />
        <Field label={t("colour")} {...field("color")} type="color" className="p-1" />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">{t("geometry")}</legend>
        <NumberField label={t("diameter")} {...number("diameter")} quantity="length" min={0} />
        <NumberField label={t("flutes")} {...number("fluteCount")} integer min={1} />
        <NumberField
          label={t("fluteLength")}
          {...number("fluteLength")}
          quantity="length"
          min={0}
        />
        {isEndMill && (
          <SelectField
            label={t("cutDirection")}
            id="cutDirection"
            defaultValue={tool.cutDirection ?? "upcut"}
            options={{
              upcut: t("cutDirections.upcut"),
              downcut: t("cutDirections.downcut"),
              compression: t("cutDirections.compression"),
            }}
            error={errors.cutDirection}
          />
        )}
        {type === "v_bit" && (
          <>
            <NumberField label={t("vAngle")} {...number("vAngle")} suffix="°" min={0} />
            <NumberField
              label={t("tipDiameter")}
              {...number("tipDiameter")}
              defaultValue={tool.tipDiameter ?? 0}
              quantity="length"
              min={0}
            />
          </>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">{t("cuttingData")}</legend>
        <NumberField
          label={t("spindleSpeed")}
          {...number("spindleRpm")}
          suffix="RPM"
          integer
          step={1000}
          min={0}
        />
        <NumberField label={t("feedRate")} {...number("feedRate")} quantity="feed" min={0} />
        <NumberField label={t("plungeRate")} {...number("plungeRate")} quantity="feed" min={0} />
        {/* Drills always plunge straight down. */}
        {type !== "drill" && (
          <NumberField
            label={t("plungeAngle")}
            {...number("plungeAngle")}
            suffix="°"
            min={1}
            max={90}
          />
        )}
        <NumberField label={t("stepDown")} {...number("stepDown")} quantity="length" min={0} />
        <NumberField label={t("stepOver")} {...number("stepOver")} suffix="%" min={0} max={100} />
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea id="notes" name="notes" defaultValue={tool.notes ?? ""} />
      </div>

      <FormError message={errors.form ?? null} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : id ? t("saveChanges") : t("add")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

/** The bit types as picture cards, so the profile is visible while choosing. */
function TypePicker({
  value,
  onChange,
  error,
}: {
  value: ToolType;
  onChange: (type: ToolType) => void;
  error?: Translatable;
}) {
  const t = useTranslations("Bit");
  return (
    <div
      role="radiogroup"
      aria-labelledby="type-label"
      aria-describedby={error ? "type-error" : undefined}
      className="grid gap-2 sm:col-span-full"
    >
      <span id="type-label" className="text-sm leading-none font-medium">
        {t("type")}
      </span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ToolType.options.map((type) => (
          <label
            key={type}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-md border p-3 text-sm shadow-xs transition-colors hover:bg-accent has-checked:border-primary has-checked:bg-accent has-checked:ring-1 has-checked:ring-primary has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
          >
            <input
              type="radio"
              name="type"
              value={type}
              checked={value === type}
              onChange={() => onChange(type)}
              className="sr-only"
            />
            <BitTypeIcon type={type} className="h-14 w-7" />
            {t(`types.${type}`)}
          </label>
        ))}
      </div>
      <FieldError id="type" error={error} />
    </div>
  );
}
