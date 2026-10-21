"use client";

import { type Machine, NEW_MACHINE_DEFAULTS, type RequiredPresetField } from "@furrow/document";
import { FormError } from "@furrow/ui/components/form-error";
import { Field, FieldError, fieldProps, SelectField } from "@furrow/ui/components/form-fields";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { Label } from "@furrow/ui/components/ui/label";
import { Textarea } from "@furrow/ui/components/ui/textarea";
import type * as React from "react";
import { type FormEvent, useState, useTransition } from "react";
import { useTranslations } from "use-intl";
import { PlaceholderList } from "../../components/placeholder-list";
import { POST_PROCESSOR_LABELS } from "../lib/labels";
import type { MachineFormErrors } from "../lib/machine-form-data";

/** The custom G-code blocks; the placeholders without words stay as they are in every language. */
const GCODE_BLOCKS = [
  { name: "programStart", placeholder: "G21\nG90\nG94" },
  { name: "programEnd", placeholder: "M5\nM30" },
  { name: "operationStart", placeholder: null },
  { name: "toolChange", placeholder: null },
] as const satisfies { name: keyof Machine; placeholder: string | null }[];

/**
 * Saves the form's fields as machine `id`, or a new machine when `null`.
 * Resolves with why it couldn't (nothing on success), or leaves the page.
 */
export type SaveMachine = (id: string | null, form: FormData) => Promise<MachineFormErrors>;

/**
 * Edits the machine `id`, or creates one when `id` is `null`, starting from
 * `values` (e.g. a preset's), through `save`. `asked` fields are marked for
 * the user to fill in. `cancel` is the way back, a link or a button inside
 * the outline Cancel button.
 */
export function MachineForm({
  id = null,
  values = {},
  asked = [],
  save,
  cancel,
}: {
  id?: string | null;
  values?: Partial<Machine>;
  asked?: RequiredPresetField[];
  save: SaveMachine;
  cancel: React.ReactElement;
}) {
  const machine = id === null ? { ...NEW_MACHINE_DEFAULTS, ...values } : values;
  // A new machine leaves the speeds out (unset) unless a preset says the spindle is manual (`null`).
  const [manualSpindle, setManualSpindle] = useState(machine.spindleRpmMin === null);
  const t = useTranslations("Machine");
  const [errors, setErrors] = useState<MachineFormErrors>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setErrors(await save(id, form));
    });
  }

  const field = fieldProps(machine, errors);
  const number = fieldProps(machine, errors, null);
  const ask = (name: RequiredPresetField) => asked.includes(name) && <AskedHint />;

  return (
    <form onSubmit={onSubmit} className="grid gap-8" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("name")} {...field("name")} placeholder={t("namePlaceholder")} />
        <SelectField
          label={t("postProcessor")}
          id="postProcessor"
          defaultValue={machine.postProcessor ?? "grbl"}
          options={POST_PROCESSOR_LABELS}
          error={errors.postProcessor}
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">{t("workArea")}</legend>
        <div className="grid content-start gap-1">
          <NumberField label={t("xTravel")} {...number("workAreaX")} quantity="length" min={0} />
          {ask("workAreaX")}
        </div>
        <div className="grid content-start gap-1">
          <NumberField label={t("yTravel")} {...number("workAreaY")} quantity="length" min={0} />
          {ask("workAreaY")}
        </div>
        <div className="grid content-start gap-1">
          <NumberField label={t("zTravel")} {...number("workAreaZ")} quantity="length" min={0} />
          {ask("workAreaZ")}
        </div>
        <NumberField label={t("safeZ")} {...number("safeZ")} quantity="length" min={0} />
        <NumberField
          label={t("entryClearance")}
          {...number("entryClearance")}
          quantity="length"
          min={0}
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">{t("limits")}</legend>
        <div className="grid content-start gap-1">
          <NumberField label={t("maxFeedXY")} {...number("maxFeedXY")} quantity="feed" min={0} />
          {ask("maxFeedXY")}
        </div>
        <div className="grid content-start gap-1">
          <NumberField label={t("maxFeedZ")} {...number("maxFeedZ")} quantity="feed" min={0} />
          {ask("maxFeedZ")}
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">{t("spindle")}</legend>
        <div className="flex items-center gap-2 sm:col-span-full">
          <input
            type="checkbox"
            id="manualSpindle"
            name="manualSpindle"
            checked={manualSpindle}
            onChange={(event) => setManualSpindle(event.target.checked)}
            className="size-4 accent-primary"
            aria-describedby="manualSpindle-hint"
          />
          <Label htmlFor="manualSpindle">{t("manualSpindle")}</Label>
          <span id="manualSpindle-hint" className="text-sm text-muted-foreground">
            {t("manualSpindleHint")}
          </span>
        </div>
        {/* Ticking Manual spindle answers the question too. */}
        {asked.includes("spindleRpmMin") && !manualSpindle && (
          <div className="sm:col-span-full">
            <AskedHint />
          </div>
        )}
        {/* Hidden rather than unmounted, so unticking brings back the values typed earlier.
            The server ignores the speeds and the post-processor the delay while the spindle is
            manual: it is switched on by hand and already up to speed. */}
        <div className="contents" hidden={manualSpindle}>
          <NumberField
            label={t("minSpeed")}
            {...number("spindleRpmMin")}
            suffix="RPM"
            integer
            step={1000}
            min={0}
          />
          <NumberField
            label={t("maxSpeed")}
            {...number("spindleRpmMax")}
            suffix="RPM"
            integer
            step={1000}
            min={0}
          />
          <div className="grid content-start gap-1">
            <NumberField
              label={t("spinUpDelay")}
              {...number("spinUpDelay")}
              suffix="s"
              step={1}
              min={0}
              max={60}
            />
            <p className="text-sm text-muted-foreground">{t("spinUpHint")}</p>
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 lg:grid-cols-2">
        <legend className="mb-1 font-medium">{t("customGcode")}</legend>
        <p className="text-sm text-muted-foreground lg:col-span-full">
          {t.rich("customGcodeHint", { code: (chunks) => <code>{chunks}</code> })}{" "}
          <PlaceholderList />
        </p>
        {GCODE_BLOCKS.map(({ name, placeholder }) => (
          <div key={name} className="grid content-start gap-2">
            <Label htmlFor={name}>{t(`blocks.${name}`)}</Label>
            <Textarea
              id={name}
              name={name}
              defaultValue={machine[name] ?? ""}
              placeholder={
                placeholder ??
                (name === "operationStart"
                  ? t("operationStartPlaceholder")
                  : t("toolChangePlaceholder"))
              }
              rows={6}
              spellCheck={false}
              className="font-mono text-sm"
              aria-invalid={errors[name] ? true : undefined}
              aria-describedby={errors[name] ? `${name}-error` : undefined}
            />
            <FieldError id={name} error={errors[name]} />
          </div>
        ))}
      </fieldset>

      <FormError message={errors.form ?? null} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : id ? t("saveChanges") : t("add")}
        </Button>
        <Button asChild variant="outline">
          {cancel}
        </Button>
      </div>
    </form>
  );
}

/** Marks a field the preset left for the user, because no official source states it. */
function AskedHint() {
  const t = useTranslations("Machine");
  return <p className="text-sm text-muted-foreground">{t("askedHint")}</p>;
}
