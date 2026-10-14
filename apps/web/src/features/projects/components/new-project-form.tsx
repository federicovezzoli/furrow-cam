"use client";

import { type FormEvent, useState, useTransition } from "react";
import { FormError } from "@/components/form-error";
import { FieldError } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { MachineOption } from "@/features/machines/server";
import { createProject, type ProjectFormErrors } from "@/features/projects/actions";

/**
 * Creates a project for one of the user's `machines` (at least one). With a
 * single machine it is used without asking; with several, one must be chosen.
 */
export function NewProjectForm({ machines }: { machines: MachineOption[] }) {
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [pending, startTransition] = useTransition();
  const only = machines.length === 1 ? machines[0] : undefined;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      // Opens the new project on success, so only errors come back.
      setErrors(await createProject(form));
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2" noValidate>
      <FormError message={errors.form ?? null} />
      <Label htmlFor="name">New project</Label>
      <div className="flex max-w-xl flex-wrap gap-2">
        <Input
          id="name"
          name="name"
          placeholder="Walnut cutting board"
          className="w-auto min-w-48 flex-1"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "name-error" : undefined}
        />
        {only ? (
          <input type="hidden" name="machine" value={only.id} />
        ) : (
          <NativeSelect
            id="machine"
            name="machine"
            defaultValue=""
            aria-label="Machine"
            aria-invalid={errors.machine ? true : undefined}
            aria-describedby={errors.machine ? "machine-error" : undefined}
          >
            <NativeSelectOption value="" disabled>
              Choose a machine…
            </NativeSelectOption>
            {machines.map((machine) => (
              <NativeSelectOption key={machine.id} value={machine.id}>
                {machine.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        <Button type="submit" disabled={pending}>
          Create
        </Button>
      </div>
      <FieldError id="name" error={errors.name} />
      <FieldError id="machine" error={errors.machine} />
    </form>
  );
}
