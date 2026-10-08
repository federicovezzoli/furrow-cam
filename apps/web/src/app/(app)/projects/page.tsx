import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export default function ProjectsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <CurrentUser />
      </Suspense>
    </main>
  );
}

async function CurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <p>
        Signed in as <span className="font-medium">{session.user.email}</span>. Projects are coming
        soon.
      </p>
      <SignOutButton />
    </div>
  );
}
