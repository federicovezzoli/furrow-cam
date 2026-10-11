"use client";

import { type FormEvent, useState, useTransition } from "react";
import { FormError } from "@/components/auth/form-error";
import { FieldError } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProject, type ProjectFormErrors } from "./actions";

export function NewProjectForm() {
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [pending, startTransition] = useTransition();

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
      <div className="flex max-w-md gap-2">
        <Input
          id="name"
          name="name"
          placeholder="Walnut cutting board"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "name-error" : undefined}
        />
        <Button type="submit" disabled={pending}>
          Create
        </Button>
      </div>
      <FieldError id="name" error={errors.name} />
    </form>
  );
}
