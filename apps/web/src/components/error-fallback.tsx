"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { cn } from "@furrow/ui/lib/utils";
import { captureError } from "@furrow/workspace/lib/telemetry";
import type * as React from "react";
import { useEffect } from "react";
import { useTranslations } from "use-intl";

/** The body of an `error.tsx` boundary: logs and reports the error (ADR-0052) and offers to retry. */
export function ErrorFallback({
  error,
  retry,
  message,
  className,
  children,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  /** Already translated: the boundary says what failed. */
  message: string;
  className?: string;
  /** Extra actions next to "Try again". */
  children?: React.ReactNode;
}) {
  const t = useTranslations("Errors");
  useEffect(() => {
    console.error(error);
    captureError(error);
  }, [error]);

  return (
    <main className={cn("flex w-full flex-col items-start gap-4 p-8", className)}>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">{message}</p>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>{t("tryAgain")}</Button>
        {children}
      </div>
    </main>
  );
}
