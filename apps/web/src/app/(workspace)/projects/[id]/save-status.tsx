"use client";

import { CheckIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { LocalDate } from "@/components/local-date";
import type { AutosaveStatus, SaveState } from "@/stores/autosave";

/**
 * The top bar's save indicator. Only the state is a live region: the save
 * time fills in after hydration and would otherwise be announced on every load.
 */
export function SaveStatus({ status: { state, savedAt, error } }: { status: AutosaveStatus }) {
  return (
    <span className="flex items-center gap-1 text-ui text-muted-foreground" title={error}>
      {state === "saving" && <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />}
      {state === "saved" && <CheckIcon className="size-3.5" aria-hidden />}
      {state === "error" && <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden />}
      <span role="status" className={state === "error" ? "text-destructive" : undefined}>
        {LABELS[state]}
        {error !== undefined && <span className="sr-only">: {error}</span>}
      </span>
      {state === "saved" && <LocalDate date={savedAt} />}
    </span>
  );
}

const LABELS: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  error: "Not saved",
};
