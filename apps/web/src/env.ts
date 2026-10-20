import { z } from "zod";

const Env = z
  .object({
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().min(1),
    // PostHog project API key (ADR-0052). Unset: no usage or error tracking.
    NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
    // Our PostHog proxy domain, e.g. https://e.furrow.cam. Unset: PostHog's EU cloud.
    NEXT_PUBLIC_POSTHOG_HOST: z.url().optional(),
    // S3-compatible storage for meshes (ADR-0029). Unset: STL import is off.
    // The endpoint is unset for AWS S3 itself.
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default("auto"),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // Bearer token Vercel Cron sends to the monthly storage sweep (ADR-0029). Unset: the sweep is off.
    CRON_SECRET: z.string().min(16).optional(),
    // Largest STL file accepted, in megabytes (PRD-0005 S1).
    STL_MAX_FILE_MB: z.coerce.number().int().positive().default(50),
    // Most triangles an STL model may have (PRD-0005 S1).
    STL_MAX_TRIANGLES: z.coerce.number().int().positive().default(2_000_000),
  })
  .refine(
    ({ S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY }) =>
      [S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY].every((value) => value === undefined) ||
      [S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY].every((value) => value !== undefined),
    {
      message: "Set all of S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or none",
      path: ["S3_BUCKET"],
    },
  );

/** Empty variables (as in `.env.example`) count as unset. */
function unsetIfEmpty(...names: string[]) {
  return Object.fromEntries(names.map((name) => [name, process.env[name] || undefined]));
}

/** Server-side environment, validated on first import. Never import from client components. */
export const env = Env.parse({
  ...process.env,
  ...unsetIfEmpty(
    "RESEND_API_KEY",
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "CRON_SECRET",
    "STL_MAX_FILE_MB",
    "STL_MAX_TRIANGLES",
  ),
});
