"use client";

import { PROJECT_FILE_EXTENSION } from "@furrow/document";
import { UploadIcon } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { type ChangeEvent, type FormEvent, useRef, useState, useTransition } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { MachineOption } from "@/lib/machines";
import { importProject } from "./actions";

// `serverActions.bodySizeLimit` in next.config.ts is 4 MiB; the file is sent as is (multipart),
// so this leaves room for the rest of the request.
const MAX_FILE_SIZE = 4_000_000;

/**
 * Picks an exported project file and creates a project from it. A file
 * without a machine gets the user's only machine, or asks which of
 * `machines` (at least one) to use.
 */
export function ImportProjectButton({ machines }: { machines: MachineOption[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  // A machine-less file waiting for the user to choose its machine.
  const [choosing, setChoosing] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const only = machines.length === 1 ? machines[0] : undefined;

  function upload(file: File, machineId: string | null) {
    startTransition(async () => {
      try {
        // Opens the new project on success, so only errors come back.
        const result = await importProject(file, machineId);
        if (result && "chooseMachine" in result) {
          setError(null);
          setChoosing(file);
          return;
        }
        setChoosing(null);
        setError(result?.error ?? null);
      } catch (error) {
        // The redirect to the new project rejects the call too; let Next.js handle it.
        unstable_rethrow(error);
        setChoosing(null);
        setError("This file couldn't be imported. Check your connection and try again.");
      }
    });
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError("This file is too large to import (the limit is 4 MB).");
      return;
    }
    // With several machines, the server says whether the file needs one chosen.
    upload(file, only?.id ?? null);
  }

  function onChoose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const machineId = new FormData(event.currentTarget).get("machine");
    if (choosing && typeof machineId === "string" && machineId !== "") upload(choosing, machineId);
  }

  return (
    <div className="grid gap-2">
      <FormError message={error} />
      <div>
        <input
          ref={input}
          type="file"
          accept={`${PROJECT_FILE_EXTENSION},.json,application/json`}
          onChange={onChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
        <Button variant="outline" onClick={() => input.current?.click()} disabled={pending}>
          <UploadIcon />
          Import file…
        </Button>
      </div>
      <Dialog open={choosing !== null} onOpenChange={(open) => !open && setChoosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a machine</DialogTitle>
            <DialogDescription>
              This file isn't set up for a machine yet. Choose the one its project is for.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onChoose} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="import-machine">Machine</Label>
              <NativeSelect id="import-machine" name="machine" defaultValue="" required>
                <NativeSelectOption value="" disabled>
                  Choose a machine…
                </NativeSelectOption>
                {machines.map((machine) => (
                  <NativeSelectOption key={machine.id} value={machine.id}>
                    {machine.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setChoosing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Import
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
