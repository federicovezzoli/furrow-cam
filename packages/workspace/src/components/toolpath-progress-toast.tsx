"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { toolpathProgress } from "../lib/toolpath-progress";
import { useDocumentStore, useToolpathStore } from "../providers/workspace-stores";

/** How long toolpaths compute before the toast shows, so it doesn't flash while a value is scrubbed. */
const SHOW_AFTER_MS = 300;

/**
 * A toast in the viewport's bottom left corner while toolpaths compute,
 * over everything else there (the selected operation's properties are z-10)
 * (#333): the operation computing now, with its progress when it reports
 * it, how many of the batch are done, and a way to cancel it.
 */
export function ToolpathProgressToast() {
  const t = useTranslations("ToolpathProgress");
  const operations = useDocumentStore((s) => s.document.operations);
  const entries = useToolpathStore((s) => s.entries);
  const controls = useToolpathStore((s) => s.controls);
  const batch = useRef<ReadonlySet<string>>(new Set());
  const result = toolpathProgress(operations, entries, batch.current);
  batch.current = result.batch;
  const { summary } = result;
  const active = summary !== null;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [active]);

  const percent =
    summary?.running.progress === undefined
      ? undefined
      : Math.floor(summary.running.progress * 100);
  // The live region stays mounted, so screen readers announce what appears in it.
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute bottom-2 left-2 z-20 w-72 max-w-[calc(100%-1rem)]"
    >
      {shown && summary && (
        <div className="pointer-events-auto grid gap-2 rounded-md border bg-background/85 p-3 text-ui shadow-xs backdrop-blur-md">
          <p className="text-muted-foreground">
            {t("title", { done: summary.done, total: summary.total })}
          </p>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate">{summary.running.name}</p>
            {percent !== undefined && (
              <span aria-hidden className="shrink-0 text-muted-foreground tabular-nums">
                {percent}%
              </span>
            )}
          </div>
          {/* Without a value, the bar shows an indeterminate state. */}
          <progress
            aria-label={t("progress", { name: summary.running.name })}
            max={100}
            value={percent}
            className="h-1.5 w-full accent-primary"
          />
          <Button
            variant="outline"
            size="compact"
            className="justify-self-end"
            aria-label={t("cancelLabel", { name: summary.running.name })}
            onClick={() => controls.cancel(summary.running.id)}
          >
            {t("cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
