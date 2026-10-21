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
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "use-intl";
import { authClient } from "@/features/auth/lib/auth-client";
import { authErrorMessage } from "@/features/auth/lib/auth-error";
import { PASSWORD_MIN_LENGTH } from "@/features/auth/lib/password-policy";
import { PasswordField } from "./password-field";

export function ResetPasswordForm() {
  const t = useTranslations("Auth");
  const errors = useTranslations("AuthErrors");
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
    if (error) return setError(authErrorMessage(errors, error, "reset"));
    router.push("/sign-in");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("chooseNewPassword")}</CardTitle>
        {!token && <CardDescription>{t("invalidLink")}</CardDescription>}
      </CardHeader>
      {token && (
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <PasswordField
              label={t("newPassword")}
              id="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
            />
            <FormError message={error} />
            <Button type="submit" disabled={pending}>
              {pending ? t("saving") : t("setNewPassword")}
            </Button>
          </form>
        </CardContent>
      )}
      <CardFooter className="text-sm text-muted-foreground">
        <Link href={token ? "/sign-in" : "/forgot-password"} className="underline">
          {token ? t("backToSignIn") : t("requestNewLink")}
        </Link>
      </CardFooter>
    </Card>
  );
}
