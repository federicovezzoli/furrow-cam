import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { createElement } from "react";
import ResetPassword, { resetPasswordSubject } from "@/emails/reset-password";
import VerifyEmail, { verifyEmailSubject } from "@/emails/verify-email";
import { env } from "@/env";
import { deleteUserObjects } from "@/features/assets/server";
import { isPasswordBreached } from "@/features/auth/lib/breached-password";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/features/auth/lib/password-policy";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { requestLocale } from "@/lib/locale-cookie";

// Endpoints that set a password, and the body field holding it (ADR-0023).
const NEW_PASSWORD_FIELDS: Record<string, string> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
};

/**
 * The language of the request that asked for an email, as the app picks it
 * (ADR-0054): no language is stored on the account (ADR-0013). English when
 * the email is sent from the server without a request.
 */
function emailLocale(request: Request | undefined) {
  return request ? requestLocale(request.headers) : "en";
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }, request) => {
      const locale = emailLocale(request);
      await sendEmail({
        to: user.email,
        subject: resetPasswordSubject(locale),
        template: createElement(ResetPassword, { url, locale }),
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }, request) => {
      const locale = emailLocale(request);
      await sendEmail({
        to: user.email,
        subject: verifyEmailSubject(locale),
        template: createElement(VerifyEmail, { url, locale }),
      });
    },
  },
  // Account deletion (#28) is immediate and cascades to projects, tools, machines and sessions.
  // Meshes are deleted from storage too.
  user: {
    // When the user finished or skipped each guided tour (#138); they come back on the session.
    additionalFields: {
      appTourDoneAt: { type: "date", required: false, input: false },
      workspaceTourDoneAt: { type: "date", required: false, input: false },
    },
    deleteUser: {
      enabled: true,
      // Pending password-reset tokens hold the user id; the privacy policy promises nothing is left.
      afterDelete: async (user) => {
        await db.verification.deleteMany({ where: { value: user.id } });
        // Project rows cascade; their meshes (ADR-0029) are objects under the user's prefix.
        await deleteUserObjects(user.id);
      },
    },
  },
  // `/delete-user` checks the password, so it gets the same strict limit Better Auth gives sign-in.
  // `/reset-password` too: the breached-password check below runs before Better Auth validates the
  // token, so each request can hold an outbound HIBP call open (ADR-0023).
  // Counters live in Postgres so every serverless instance shares them (#274).
  rateLimit: {
    storage: "database",
    customRules: {
      "/delete-user": { window: 10, max: 3 },
      "/reset-password": { window: 10, max: 3 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Better Auth also deletes without a password when the session is fresh; we always ask for it.
      if (ctx.path === "/delete-user" && !ctx.body?.password) {
        throw new APIError("BAD_REQUEST", {
          code: "PASSWORD_REQUIRED",
          message: "Enter your password to delete your account.",
        });
      }
      // Reject breached passwords (ADR-0023). Out-of-range lengths are left to Better Auth,
      // and the check fails open: if Have I Been Pwned is unreachable, the password is accepted.
      // It runs here rather than when Better Auth hashes the password because `/reset-password`
      // consumes the token before hashing: a rejection there would burn the reset link.
      const field = NEW_PASSWORD_FIELDS[ctx.path];
      const password: unknown = field ? ctx.body?.[field] : undefined;
      if (
        typeof password !== "string" ||
        password.length < PASSWORD_MIN_LENGTH ||
        password.length > PASSWORD_MAX_LENGTH
      ) {
        return;
      }
      const breached = await isPasswordBreached(password);
      if (breached === null) {
        console.warn(`Breached-password check unavailable on ${ctx.path}; accepting the password.`);
      } else if (breached) {
        throw new APIError("BAD_REQUEST", {
          code: "PASSWORD_BREACHED",
          message: "This password has appeared in a data breach. Please choose a different one.",
        });
      }
    }),
  },
  // Data minimisation (ADR-0013): `name` is a required Better Auth column; it always mirrors the email.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, name: user.email, image: null } }),
        // Every account starts with one bit in its tool library (#10). Runs after the user
        // row is committed, so a failure here must not fail the sign-up: the account just
        // starts with an empty library.
        after: async (user) => {
          try {
            // Imported here: `tools/server` is server-only, and the Better Auth CLI loads this
            // file outside Next.js to generate the schema (ADR-0021).
            const { createDefaultTool } = await import("@/features/tools/server");
            await createDefaultTool(user.id);
          } catch (error) {
            console.error(`Failed to seed the default bit for user ${user.id}`, error);
          }
        },
      },
      update: {
        before: async ({ name: _name, image: _image, ...user }) => ({
          data: user.email ? { ...user, name: user.email } : user,
        }),
      },
    },
  },
  // Must be the last plugin: lets server actions set auth cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
