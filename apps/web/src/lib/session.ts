import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/** The signed-in user's id, or `null` when signed out. Read it inside `<Suspense>`. */
export async function getUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

/** The signed-in user's id; redirects to sign-in otherwise. Read it inside `<Suspense>`. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) redirect("/sign-in");
  return userId;
}
