"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    setPending(true);
    setError(null);
    setUnverifiedEmail(null);
    const { error } = await authClient.signIn.email({
      email,
      password: String(form.get("password")),
    });
    setPending(false);
    if (error?.code === "EMAIL_NOT_VERIFIED") {
      setUnverifiedEmail(email);
      return setError("Please verify your email first. Check your inbox for the link.");
    }
    if (error) return setError(error.message ?? "Sign-in failed.");
    router.push("/projects");
    router.refresh();
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    await authClient.sendVerificationEmail({ email: unverifiedEmail, callbackURL: "/projects" });
    router.push(`/check-email?email=${encodeURIComponent(unverifiedEmail)}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FormField label="Email" id="email" type="email" autoComplete="email" />
          <FormField
            label="Password"
            id="password"
            type="password"
            autoComplete="current-password"
          />
          <FormError message={error} />
          {unverifiedEmail && (
            <Button type="button" variant="outline" onClick={resendVerification}>
              Resend verification email
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex justify-between text-sm text-muted-foreground">
        <Link href="/forgot-password" className="underline">
          Forgot password?
        </Link>
        <Link href="/sign-up" className="underline">
          Create an account
        </Link>
      </CardFooter>
    </Card>
  );
}
