import { Resend } from "resend";
import { env } from "@/env";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Sends a transactional email via Resend (ADR-0006).
 * Without RESEND_API_KEY, emails are printed to the console in development and fail in production.
 */
export async function sendEmail({ to, subject, text }: Email): Promise<void> {
  if (!resend) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set");
    console.info(`\n[email] To: ${to}\n[email] Subject: ${subject}\n\n${text}\n`);
    return;
  }

  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, text });
  if (error) throw new Error(`Failed to send email to ${to}: ${error.message}`);
}
