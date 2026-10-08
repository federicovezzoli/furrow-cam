"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({
      token,
      newPassword: String(form.get("password")),
    });
    setPending(false);
    if (error) return setError(error.message ?? "Could not reset the password.");
    router.push("/sign-in");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        {!token && <CardDescription>This reset link is invalid or has expired.</CardDescription>}
      </CardHeader>
      {token && (
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <FormField
              label="New password"
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
            />
            <FormError message={error} />
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Set new password"}
            </Button>
          </form>
        </CardContent>
      )}
      <CardFooter className="text-sm text-muted-foreground">
        <Link href={token ? "/sign-in" : "/forgot-password"} className="underline">
          {token ? "Back to sign in" : "Request a new link"}
        </Link>
      </CardFooter>
    </Card>
  );
}
