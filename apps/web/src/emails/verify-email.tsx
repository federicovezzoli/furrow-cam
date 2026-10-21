import { translator } from "@furrow/ui/lib/i18n";
import type { Locale } from "@furrow/ui/lib/locales";
import { EmailLayout, EmailText } from "./layout";

export interface VerifyEmailProps {
  url: string;
  /** The requester's language (ADR-0054). */
  locale: Locale;
}

export function verifyEmailSubject(locale: Locale) {
  return translator(locale)("Emails.verify.subject");
}

export default function VerifyEmail({ url, locale }: VerifyEmailProps) {
  const t = translator(locale);
  return (
    <EmailLayout
      locale={locale}
      preview={t("Emails.verify.preview")}
      action={{ label: t("Emails.verify.action"), url }}
      reason={t("Emails.verify.reason")}
    >
      <EmailText>{t("Emails.verify.body")}</EmailText>
    </EmailLayout>
  );
}

// Edit `locale` in the preview's props panel to see each language.
VerifyEmail.PreviewProps = {
  url: "http://localhost:3000/api/auth/verify-email?token=preview",
  locale: "en",
} satisfies VerifyEmailProps;
