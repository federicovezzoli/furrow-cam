import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
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
        subject: "Reset your Furrow CAM password",
        text: `Open this link to choose a new password:\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your Furrow CAM email",
        text: `Open this link to verify your email address:\n${url}`,
      });
    },
  },
  // Data minimisation (ADR-0013): no name or avatar is stored for users.
  databaseHooks: {
    user: {
      // `name` is a required Better Auth column; we never collect it.
      create: { before: async (user) => ({ data: { ...user, name: "", image: null } }) },
      update: {
        before: async ({ name: _name, image: _image, ...user }) => ({ data: user }),
      },
    },
  },
  // Must be the last plugin: lets server actions set auth cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
