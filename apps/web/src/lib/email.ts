import type { ReactElement } from "react";
import { render } from "react-email";
import { Resend } from "resend";
import { env } from "@/env";

export interface Email {
  to: string;
  subject: string;
  /** A React Email template from `src/emails/`, rendered to both HTML and plain text. */
  template: ReactElement;
}

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/** Renders a template to the HTML and plain-text bodies of one email. */
export async function renderEmail(template: ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(template), render(template, { plainText: true })]);
  return { html, text };
}

/**
 * Sends a transactional email via Resend (ADR-0006). Open and click tracking stay off
 * in the Resend domain settings (ADR-0013).
 * Without RESEND_API_KEY, the text version is printed to the console in development and
 * sending fails in production.
 */
export async function sendEmail({ to, subject, template }: Email): Promise<void> {
  if (!resend && process.env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY is not set");
  }

  const { html, text } = await renderEmail(template);
  if (!resend) {
    console.info(`\n[email] To: ${to}\n[email] Subject: ${subject}\n\n${text}\n`);
    return;
  }

  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html, text });
  if (error) throw new Error(`Failed to send email to ${to}: ${error.message}`);
}
