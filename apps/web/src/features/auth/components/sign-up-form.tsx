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
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/features/auth/lib/auth-client";
import { PASSWORD_MIN_LENGTH } from "@/features/auth/lib/password-policy";
import { FormField } from "./form-field";
import { PasswordField } from "./password-field";

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: email, // Required by the Better Auth API; the server sets it to the email anyway (ADR-0013).
      email,
      password: String(form.get("password")),
      callbackURL: "/projects",
    });
    setPending(false);
    if (error) return setError(error.message ?? "Sign-up failed.");
    router.push(`/check-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>Save your projects, tools and machines.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FormField label="Email" id="email" type="email" autoComplete="email" />
          <PasswordField
            label="Password"
            id="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
          />
          <FormError message={error} />
          <Button type="submit" disabled={pending}>
            {pending ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-xs text-muted-foreground">
            We only ask for your email address. Read the{" "}
            <Link href="/privacy" className="underline">
              privacy policy
            </Link>
            .
          </p>
        </form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        Already have an account?&nbsp;
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
