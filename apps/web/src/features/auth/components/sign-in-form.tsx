"use client";

import { FormError } from "@furrow/ui/components/form-error";
import { Button } from "@furrow/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@furrow/ui/components/ui/card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "use-intl";
import { authClient } from "@/features/auth/lib/auth-client";
import { authErrorMessage } from "@/features/auth/lib/auth-error";
import { FormField } from "./form-field";
import { PasswordField } from "./password-field";

export function SignInForm() {
  const t = useTranslations("Auth");
  const errors = useTranslations("AuthErrors");
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
      return setError(t("verifyFirst"));
    }
    if (error) return setError(authErrorMessage(errors, error, "signIn"));
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
        <CardTitle>{t("signInTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FormField label={t("email")} id="email" type="email" autoComplete="email" />
          <PasswordField label={t("password")} id="password" autoComplete="current-password" />
          <FormError message={error} />
          {unverifiedEmail && (
            <Button type="button" variant="outline" onClick={resendVerification}>
              {t("resendVerification")}
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? t("signingIn") : t("signIn")}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex justify-between text-sm text-muted-foreground">
        <Link href="/forgot-password" className="underline">
          {t("forgotPassword")}
        </Link>
        <Link href="/sign-up" className="underline">
          {t("createAnAccount")}
        </Link>
      </CardFooter>
    </Card>
  );
}
