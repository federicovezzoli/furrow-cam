"use client";

import { cn } from "cn";
import type * as React from "react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** The body of an `error.tsx` boundary: logs the error and offers to retry. */
export function ErrorFallback({
  error,
  retry,
  message,
  className,
  children,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  message: string;
  className?: string;
  /** Extra actions next to "Try again". */
  children?: React.ReactNode;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={cn("flex w-full flex-col items-start gap-4 p-8", className)}>
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground">{message}</p>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        {children}
      </div>
    </main>
  );
}
