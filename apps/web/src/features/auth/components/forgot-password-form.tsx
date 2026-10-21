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
import { useTranslations } from "use-intl";
import { authClient } from "@/features/auth/lib/auth-client";
import { authErrorMessage } from "@/features/auth/lib/auth-error";
import { FormField } from "./form-field";

export function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const errors = useTranslations("AuthErrors");
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
    if (error) return setError(authErrorMessage(errors, error, "generic"));
    setSent(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("resetTitle")}</CardTitle>
        <CardDescription>{sent ? t("resetSent") : t("resetPrompt")}</CardDescription>
      </CardHeader>
      {!sent && (
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <FormField label={t("email")} id="email" type="email" autoComplete="email" />
            <FormError message={error} />
            <Button type="submit" disabled={pending}>
              {pending ? t("sending") : t("sendResetLink")}
            </Button>
          </form>
        </CardContent>
      )}
      <CardFooter className="text-sm text-muted-foreground">
        <Link href="/sign-in" className="underline">
          {t("backToSignIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
