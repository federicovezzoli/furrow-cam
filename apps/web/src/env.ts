import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().min(1),
});

/** Server-side environment, validated on first import. Never import from client components. */
export const env = Env.parse({
  ...process.env,
  RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
});
