"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground">
        The page couldn't be loaded or your change couldn't be saved. Try again in a moment.
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
