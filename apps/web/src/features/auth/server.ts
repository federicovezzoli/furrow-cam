import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth, type Session } from "./auth";

/** The current session, or `null` when signed out; looked up once per request. Read it inside `<Suspense>`. */
export const getSession = cache(
  async (): Promise<Session | null> => auth.api.getSession({ headers: await headers() }),
);

/** The current session; redirects to sign-in otherwise. Read it inside `<Suspense>`. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/** The signed-in user's id, or `null` when signed out. Read it inside `<Suspense>`. */
export async function getUserId(): Promise<string | null> {
  return (await getSession())?.user.id ?? null;
}

/** The signed-in user's id; redirects to sign-in otherwise. Read it inside `<Suspense>`. */
export async function requireUserId(): Promise<string> {
  return (await requireSession()).user.id;
}
