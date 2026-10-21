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
import { track } from "@furrow/workspace/lib/telemetry";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "use-intl";
import { authClient } from "@/features/auth/lib/auth-client";
import { authErrorMessage } from "@/features/auth/lib/auth-error";
import { PASSWORD_MIN_LENGTH } from "@/features/auth/lib/password-policy";
import { FormField } from "./form-field";
import { PasswordField } from "./password-field";

export function SignUpForm() {
  const t = useTranslations("Auth");
  const errors = useTranslations("AuthErrors");
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
    if (error) return setError(authErrorMessage(errors, error, "signUp"));
    track({ event: "signed_up" });
    router.push(`/check-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("createAnAccount")}</CardTitle>
        <CardDescription>{t("signUpDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FormField label={t("email")} id="email" type="email" autoComplete="email" />
          <PasswordField
            label={t("password")}
            id="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
          />
          <FormError message={error} />
          <Button type="submit" disabled={pending}>
            {pending ? t("creatingAccount") : t("createAccount")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t.rich("privacyNote", {
              link: (chunks) => (
                <Link href="/privacy" className="underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        {t("alreadyHaveAccount")}&nbsp;
        <Link href="/sign-in" className="underline">
          {t("signIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
