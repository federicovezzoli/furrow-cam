"use client";

import { Button } from "@furrow/ui/components/ui/button";
import Link from "next/link";
import { ErrorFallback } from "@/components/error-fallback";

export default function WorkspaceError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      message="The project couldn't be loaded. Try again in a moment."
      className="mx-auto max-w-2xl"
    >
      <Button variant="outline" asChild>
        <Link href="/projects">All projects</Link>
      </Button>
    </ErrorFallback>
  );
}
