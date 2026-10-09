"use client";

import { CheckIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { LocalDate } from "@/app/(app)/projects/local-date";

/** Whether the document on screen matches the one stored on the server. Autosave (#15) drives it. */
export type SaveState = "saved" | "unsaved" | "saving" | "error";

/** The top bar's save indicator. */
export function SaveStatus({ state, savedAt }: { state: SaveState; savedAt: Date }) {
  return (
    <span role="status" className="flex items-center gap-1 text-ui text-muted-foreground">
      {state === "saved" && (
        <>
          <CheckIcon className="size-3.5" aria-hidden />
          <span>
            Saved <LocalDate date={savedAt} />
          </span>
        </>
      )}
      {state === "unsaved" && <span>Unsaved changes</span>}
      {state === "saving" && (
        <>
          <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
          <span>Saving…</span>
        </>
      )}
      {state === "error" && (
        <>
          <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden />
          <span className="text-destructive">Not saved</span>
        </>
      )}
    </span>
  );
}
