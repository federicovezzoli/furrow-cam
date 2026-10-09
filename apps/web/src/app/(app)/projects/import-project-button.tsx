"use client";

import { PROJECT_FILE_EXTENSION } from "@furrow/document";
import { UploadIcon } from "lucide-react";
import { type ChangeEvent, useRef, useState, useTransition } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { importProject } from "./actions";

// Matches `serverActions.bodySizeLimit` in next.config.ts, less room for the rest of the request.
const MAX_FILE_SIZE = 4_000_000;

/** Picks an exported project file and creates a project from it. */
export function ImportProjectButton() {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError("This file is too large to import (the limit is 4 MB).");
      return;
    }
    startTransition(async () => {
      // Opens the new project on success, so only errors come back.
      const result = await importProject(file.name, await file.text());
      setError(result?.error ?? null);
    });
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
    </div>
  );
}
