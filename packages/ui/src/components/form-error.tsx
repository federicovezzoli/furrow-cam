"use client";

import { useFormatMessage } from "../hooks/use-format-message";
import type { Translatable } from "../lib/i18n";
import { Alert, AlertDescription } from "./ui/alert";

export function FormError({ message }: { message: Translatable | null | undefined }) {
  const format = useFormatMessage();
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{format(message)}</AlertDescription>
    </Alert>
  );
}
