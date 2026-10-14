import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { createElement } from "react";
import ResetPassword, { resetPasswordSubject } from "@/emails/reset-password";
import VerifyEmail, { verifyEmailSubject } from "@/emails/verify-email";
import { env } from "@/env";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: resetPasswordSubject,
        template: createElement(ResetPassword, { url }),
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: verifyEmailSubject,
        template: createElement(VerifyEmail, { url }),
      });
    },
  },
  // Account deletion (#28) is immediate and cascades to projects, tools, machines and sessions.
  user: {
    deleteUser: {
      enabled: true,
      // Pending password-reset tokens hold the user id; the privacy policy promises nothing is left.
      afterDelete: async (user) => {
        await db.verification.deleteMany({ where: { value: user.id } });
      },
    },
  },
  // `/delete-user` checks the password, so it gets the same strict limit Better Auth gives sign-in.
  rateLimit: {
    customRules: { "/delete-user": { window: 10, max: 3 } },
  },
  hooks: {
    // Better Auth also deletes without a password when the session is fresh; we always ask for it.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/delete-user" && !ctx.body?.password) {
        throw new APIError("BAD_REQUEST", {
          message: "Enter your password to delete your account.",
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
