import { z } from "zod";

const Limit = z.coerce.number().int().positive().optional();

/** The freemium limits' variables (`FREEMIUM_*`), and their names. */
const LIMITS = [
  "FREEMIUM_MAX_PROJECTS",
  "FREEMIUM_MAX_TOOLS",
  "FREEMIUM_MAX_MACHINES",
  "FREEMIUM_MAX_DAILY_EXPORTS",
] as const;

/**
 * The freemium limits' environment (PRD-0003 F1, F2, ADR-0017): a flag, off
 * by default, and the four limits, each a positive integer that must be set
 * when the flag is on. Validated with the rest of `env.ts`; only
 * `lib/limits.ts` reads them.
 */
export const FreemiumEnv = z
  .object({
    FREEMIUM_ENABLED: z.stringbool().default(false),
    FREEMIUM_MAX_PROJECTS: Limit,
    FREEMIUM_MAX_TOOLS: Limit,
    FREEMIUM_MAX_MACHINES: Limit,
    FREEMIUM_MAX_DAILY_EXPORTS: Limit,
  })
  .superRefine((value, ctx) => {
    if (!value.FREEMIUM_ENABLED) return;
    for (const name of LIMITS) {
      if (value[name] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `Set ${name} when FREEMIUM_ENABLED is on`,
        });
      }
    }
  });

/** The variable names, for treating empty ones as unset. */
export const FREEMIUM_VARIABLES = ["FREEMIUM_ENABLED", ...LIMITS] as const;
