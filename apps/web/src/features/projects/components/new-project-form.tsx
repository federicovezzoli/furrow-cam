"use client";

import { FormError } from "@furrow/ui/components/form-error";
import { FieldError } from "@furrow/ui/components/form-fields";
import { Button } from "@furrow/ui/components/ui/button";
import { Input } from "@furrow/ui/components/ui/input";
import { Label } from "@furrow/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { track } from "@furrow/workspace/lib/telemetry";
import { type FormEvent, useState, useTransition } from "react";
import { useTranslations } from "use-intl";
import type { MachineOption } from "@/features/machines/server";
import { createProject, type ProjectFormErrors } from "@/features/projects/actions";

/**
 * Creates a project, for one of the user's `machines` or without one: the
 * machine can be chosen in the project later (PRD-0008 G13). A single machine
 * is picked by default; with none, the form doesn't ask.
 */
export function NewProjectForm({ machines }: { machines: MachineOption[] }) {
  const t = useTranslations("Projects");
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      // On success the action redirects to the new project, which Next 16 delivers by
      // rejecting this call with its redirect error; only errors resolve.
      const errors = await createProject(form).catch((error: unknown) => {
        if (isRedirect(error)) track({ event: "project_created" });
        throw error;
      });
      setErrors(errors);
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2" noValidate>
      <FormError message={errors.form ?? null} />
      <Label htmlFor="name">{t("newProject")}</Label>
      <div className="flex max-w-xl flex-wrap gap-2">
        <Input
          id="name"
          name="name"
          placeholder={t("namePlaceholder")}
          className="w-auto min-w-48 flex-1"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "name-error" : undefined}
        />
        {machines.length > 0 && (
          <NativeSelect
            id="machine"
            name="machine"
            defaultValue={machines.length === 1 ? machines[0]?.id : ""}
            aria-label={t("machine")}
            aria-invalid={errors.machine ? true : undefined}
            aria-describedby={errors.machine ? "machine-error" : undefined}
          >
            <NativeSelectOption value="">{t("noMachineYet")}</NativeSelectOption>
            {machines.map((machine) => (
              <NativeSelectOption key={machine.id} value={machine.id}>
                {machine.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        <Button type="submit" disabled={pending}>
          {t("create")}
        </Button>
      </div>
      <FieldError id="name" error={errors.name} />
      <FieldError id="machine" error={errors.machine} />
    </form>
  );
}

/** Next's redirect errors carry a `NEXT_REDIRECT…` digest; it exports no check for them. */
function isRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String(error.digest).startsWith("NEXT_REDIRECT")
  );
}
