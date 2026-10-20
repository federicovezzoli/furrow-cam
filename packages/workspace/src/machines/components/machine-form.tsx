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
import { PlaceholderList } from "../../components/placeholder-list";
import { POST_PROCESSOR_LABELS } from "../lib/labels";
import type { MachineFormErrors } from "../lib/machine-form-data";

const GCODE_BLOCKS = [
  { name: "programStart", label: "Program start", placeholder: "G21\nG90\nG94" },
  { name: "programEnd", label: "Program end", placeholder: "M5\nM30" },
  { name: "operationStart", label: "Operation start", placeholder: "(Pocket the recess)" },
  { name: "toolChange", label: "Tool change", placeholder: "M5\nM0 (Change the bit)" },
] as const satisfies { name: keyof Machine; label: string; placeholder: string }[];

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
        <Field label="Name" {...field("name")} placeholder="Shapeoko 4 XL" />
        <SelectField
          label="Post-processor"
          id="postProcessor"
          defaultValue={machine.postProcessor ?? "grbl"}
          options={POST_PROCESSOR_LABELS}
          error={errors.postProcessor}
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">Work area</legend>
        <div className="grid content-start gap-1">
          <NumberField label="X travel" {...number("workAreaX")} quantity="length" min={0} />
          {ask("workAreaX")}
        </div>
        <div className="grid content-start gap-1">
          <NumberField label="Y travel" {...number("workAreaY")} quantity="length" min={0} />
          {ask("workAreaY")}
        </div>
        <div className="grid content-start gap-1">
          <NumberField label="Z travel" {...number("workAreaZ")} quantity="length" min={0} />
          {ask("workAreaZ")}
        </div>
        <NumberField label="Safe Z (above stock)" {...number("safeZ")} quantity="length" min={0} />
        <NumberField
          label="Entry clearance (above stock)"
          {...number("entryClearance")}
          quantity="length"
          min={0}
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">Limits</legend>
        <div className="grid content-start gap-1">
          <NumberField label="Max feed X/Y" {...number("maxFeedXY")} quantity="feed" min={0} />
          {ask("maxFeedXY")}
        </div>
        <div className="grid content-start gap-1">
          <NumberField label="Max feed Z" {...number("maxFeedZ")} quantity="feed" min={0} />
          {ask("maxFeedZ")}
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">Spindle</legend>
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
          <Label htmlFor="manualSpindle">Manual spindle</Label>
          <span id="manualSpindle-hint" className="text-sm text-muted-foreground">
            Speed set by hand (e.g. a trim router dial); the G-code sets no spindle speed.
          </span>
        </div>
        {/* Ticking Manual spindle answers the question too. */}
        {asked.includes("spindleRpmMin") && !manualSpindle && (
          <div className="sm:col-span-full">
            <AskedHint />
          </div>
        )}
        {/* Hidden rather than unmounted, so unticking brings back the speeds typed earlier.
            The server ignores them while the spindle is manual. */}
        <div className="contents" hidden={manualSpindle}>
          <NumberField
            label="Min speed"
            {...number("spindleRpmMin")}
            suffix="RPM"
            integer
            step={1000}
            min={0}
          />
          <NumberField
            label="Max speed"
            {...number("spindleRpmMax")}
            suffix="RPM"
            integer
            step={1000}
            min={0}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 lg:grid-cols-2">
        <legend className="mb-1 font-medium">Custom G-code</legend>
        <p className="text-sm text-muted-foreground lg:col-span-full">
          A filled-in block replaces what the post-processor writes at that point, so include
          everything your machine needs there (e.g. <code>G21</code> and <code>G90</code> in the
          program start). Leave a block empty to keep the default. Text is copied as is, apart from
          placeholders. <PlaceholderList />
        </p>
        {GCODE_BLOCKS.map(({ name, label, placeholder }) => (
          <div key={name} className="grid content-start gap-2">
            <Label htmlFor={name}>{label}</Label>
            <Textarea
              id={name}
              name={name}
              defaultValue={machine[name] ?? ""}
              placeholder={placeholder}
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
          {pending ? "Saving…" : id ? "Save changes" : "Add machine"}
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
  return <p className="text-sm text-muted-foreground">Fill in for your machine.</p>;
}
