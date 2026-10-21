import { translator } from "@furrow/ui/lib/i18n";
import type { Locale } from "@furrow/ui/lib/locales";
import { EmailLayout, EmailText } from "./layout";

export interface ResetPasswordProps {
  url: string;
  /** The requester's language (ADR-0054). */
  locale: Locale;
}

export function resetPasswordSubject(locale: Locale) {
  return translator(locale)("Emails.reset.subject");
}

export default function ResetPassword({ url, locale }: ResetPasswordProps) {
  const t = translator(locale);
  return (
    <EmailLayout
      locale={locale}
      preview={t("Emails.reset.preview")}
      action={{ label: t("Emails.reset.action"), url }}
      reason={t("Emails.reset.reason")}
    >
      <EmailText>{t("Emails.reset.body")}</EmailText>
      <EmailText>{t("Emails.reset.next")}</EmailText>
    </EmailLayout>
  );
}

// Edit `locale` in the preview's props panel to see each language.
ResetPassword.PreviewProps = {
  url: "http://localhost:3000/reset-password?token=preview",
  locale: "en",
} satisfies ResetPasswordProps;
