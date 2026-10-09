"use client";

import { CheckIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { LocalDate } from "@/components/local-date";

/** Whether the document on screen matches the one stored on the server. Autosave (#15) drives it. */
export type SaveState = "saved" | "unsaved" | "saving" | "error";

/**
 * The top bar's save indicator. Only the state is a live region: the save
 * time fills in after hydration and would otherwise be announced on every load.
 */
export function SaveStatus({ state, savedAt }: { state: SaveState; savedAt: Date }) {
  return (
    <span className="flex items-center gap-1 text-ui text-muted-foreground">
      {state === "saving" && <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />}
      {state === "saved" && <CheckIcon className="size-3.5" aria-hidden />}
      {state === "error" && <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden />}
      <span role="status" className={state === "error" ? "text-destructive" : undefined}>
        {LABELS[state]}
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
