"use client";

import { LocalDate } from "@furrow/ui/components/local-date";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import { CheckIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import type { AutosaveStatus } from "../stores/autosave";

/**
 * The top bar's save indicator. Only the state is a live region: the save
 * time fills in after hydration and would otherwise be announced on every load.
 */
export function SaveStatus({ status: { state, savedAt, error } }: { status: AutosaveStatus }) {
  const t = useTranslations("Shell");
  const format = useFormatMessage();
  const reason = error === undefined ? undefined : format(error);
  return (
    <span className="flex items-center gap-1 text-ui text-muted-foreground" title={reason}>
      {state === "saving" && <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />}
      {state === "saved" && <CheckIcon className="size-3.5" aria-hidden />}
      {(state === "error" || state === "failed") && (
        <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden />
      )}
      <span
        role="status"
        className={state === "error" || state === "failed" ? "text-destructive" : undefined}
      >
        {t(`saveStates.${state}`)}
        {reason !== undefined && <span className="sr-only">: {reason}</span>}
      </span>
      {state === "saved" && <LocalDate date={savedAt} />}
    </span>
  );
}
