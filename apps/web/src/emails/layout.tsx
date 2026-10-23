import { translator } from "@furrow/ui/lib/i18n";
import type { Locale } from "@furrow/ui/lib/locales";
import type { ReactNode } from "react";
import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text } from "react-email";

/*
 * Shared layout for transactional emails (#67). Inline styles only, no remote images or
 * fonts (ADR-0013). Warm greys with square corners like the app; clients that force a
 * dark mode invert it cleanly. Consolas comes first because Outlook on Windows only
 * honours the first family in the list.
 */
const font = 'Consolas, Menlo, "SFMono-Regular", "Courier New", monospace';

const styles = {
  body: { backgroundColor: "#efece8", color: "#171310", fontFamily: font, margin: 0, padding: 0 },
  container: {
    backgroundColor: "#f8f7f4",
    border: "1px solid #dcdad6",
    margin: "32px auto",
    maxWidth: "480px",
    padding: "32px",
  },
  wordmark: { fontSize: "18px", fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 24px" },
  text: { fontSize: "14px", lineHeight: "22px", margin: "0 0 16px" },
  button: {
    backgroundColor: "#171310",
    color: "#f8f7f4",
    fontSize: "14px",
    fontWeight: 600,
    padding: "12px 20px",
    textDecoration: "none",
  },
  small: { color: "#68625e", fontSize: "12px", lineHeight: "18px", margin: "0 0 8px" },
  link: { color: "#171310", textDecoration: "underline", wordBreak: "break-all" as const },
  hr: { borderColor: "#dcdad6", margin: "24px 0" },
};

export interface EmailLayoutProps {
  locale: Locale;
  /** Inbox preview line, hidden in the body and skipped in the text version. */
  preview: string;
  /** Call-to-action label and target. */
  action: { label: string; url: string };
  /** Footer line explaining why this email was sent. */
  reason: string;
  children: ReactNode;
}

export function EmailLayout({ locale, preview, action, reason, children }: EmailLayoutProps) {
  const t = translator(locale);
  return (
    <Html lang={locale}>
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.wordmark}>Furrow CAM</Text>
          {children}
          <Section style={{ margin: "24px 0" }}>
            <Button href={action.url} style={styles.button}>
              {action.label}
            </Button>
          </Section>
          {/* The text version already prints the URL next to the button label. */}
          <Section data-skip-in-text="true">
            <Text style={styles.small}>{t("Emails.fallbackLink")}</Text>
            <Text style={styles.small}>
              <Link href={action.url} style={styles.link}>
                {action.url}
              </Link>
            </Text>
          </Section>
          <Hr style={styles.hr} />
          <Text style={styles.small}>{reason}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function EmailText({ children }: { children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}
