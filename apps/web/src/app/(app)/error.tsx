"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function AppError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ErrorFallback
      {...props}
      message="The page couldn't be loaded or your change couldn't be saved. Try again in a moment."
      className="mx-auto max-w-screen-2xl flex-1"
    />
  );
}
