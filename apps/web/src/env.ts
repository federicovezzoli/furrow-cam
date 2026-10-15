import { z } from "zod";

const Env = z
  .object({
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().min(1),
    // GoatCounter endpoint, e.g. https://<code>.goatcounter.com/count (ADR-0020). Unset: no analytics.
    NEXT_PUBLIC_GOATCOUNTER_URL: z.url().optional(),
    // S3-compatible storage for meshes (ADR-0029). Unset: STL import is off.
    // The endpoint is unset for AWS S3 itself.
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default("auto"),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // Largest STL file accepted, in megabytes (PRD-0005 S1).
    STL_MAX_FILE_MB: z.coerce.number().int().positive().default(50),
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
    "NEXT_PUBLIC_GOATCOUNTER_URL",
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "STL_MAX_FILE_MB",
  ),
});
