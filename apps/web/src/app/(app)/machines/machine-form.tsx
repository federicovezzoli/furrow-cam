"use client";

import type { Machine } from "@furrow/document";
import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";
import { FormError } from "@/components/auth/form-error";
import { Field, FieldError, fieldProps, SelectField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type MachineFormErrors, saveMachine } from "./actions";
import { POST_PROCESSOR_LABELS } from "./labels";

/** Starting values for a new machine; the rest of the fields start empty. */
const NEW_MACHINE: Partial<Machine> = {
  safeZ: 5,
  postProcessor: "grbl",
};

const GCODE_BLOCKS = [
  { name: "programStart", label: "Program start", placeholder: "G21\nG90\nG94" },
  { name: "programEnd", label: "Program end", placeholder: "M5\nM30" },
  { name: "operationStart", label: "Operation start", placeholder: "(Pocket the recess)" },
  { name: "toolChange", label: "Tool change", placeholder: "M5\nM0 (Change the bit)" },
] as const satisfies { name: keyof Machine; label: string; placeholder: string }[];

/** Edits the machine `id`, or creates one when `id` is `null`. */
export function MachineForm({
  id = null,
  values = {},
}: {
  id?: string | null;
  values?: Partial<Machine>;
}) {
  const machine = id === null ? { ...NEW_MACHINE, ...values } : values;
  const [manualSpindle, setManualSpindle] = useState(id !== null && machine.spindleRpmMin == null);
  const [errors, setErrors] = useState<MachineFormErrors>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      // Redirects to the list on success, so only errors come back.
      setErrors(await saveMachine(id, form));
    });
  }

  const field = fieldProps(machine, errors);

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
        <Field label="X travel (mm)" {...field("workAreaX")} type="number" step="any" min={0} />
        <Field label="Y travel (mm)" {...field("workAreaY")} type="number" step="any" min={0} />
        <Field label="Z travel (mm)" {...field("workAreaZ")} type="number" step="any" min={0} />
        <Field
          label="Safe Z (mm above stock)"
          {...field("safeZ")}
          type="number"
          step="any"
          min={0}
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">Limits</legend>
        <Field
          label="Max feed X/Y (mm/min)"
          {...field("maxFeedXY")}
          type="number"
          step="any"
          min={0}
        />
        <Field
          label="Max feed Z (mm/min)"
          {...field("maxFeedZ")}
          type="number"
          step="any"
          min={0}
        />
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
        {/* Hidden rather than unmounted, so unticking brings back the speeds typed earlier.
            The server ignores them while the spindle is manual. */}
        <div className="contents" hidden={manualSpindle}>
          <Field
            label="Min speed (RPM)"
            {...field("spindleRpmMin")}
            type="number"
            step={1000}
            min={0}
          />
          <Field
            label="Max speed (RPM)"
            {...field("spindleRpmMax")}
            type="number"
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
          program start). Leave a block empty to keep the default. Text is copied as is.
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
          <Link href="/machines">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
