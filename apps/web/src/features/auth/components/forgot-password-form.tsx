"use client";

import { FormError } from "@furrow/ui/components/form-error";
import { Button } from "@furrow/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@furrow/ui/components/ui/card";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { authClient } from "@/features/auth/lib/auth-client";
import { FormField } from "./form-field";

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/reset-password",
    });
    setPending(false);
    if (error) return setError(error.message ?? "Something went wrong.");
    setSent(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          {sent
            ? "If an account exists for that email, we've sent a link to reset your password."
            : "Enter your email and we'll send you a reset link."}
        </CardDescription>
      </CardHeader>
      {!sent && (
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <FormField label="Email" id="email" type="email" autoComplete="email" />
            <FormError message={error} />
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        </CardContent>
      )}
      <CardFooter className="text-sm text-muted-foreground">
        <Link href="/sign-in" className="underline">
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
