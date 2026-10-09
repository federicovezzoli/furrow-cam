import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { getProject } from "@/lib/projects";
import { requireUserId } from "@/lib/session";

// Placeholder until the workspace UI lands (#14).
export default function WorkspacePage({ params }: PageProps<"/projects/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Workspace params={params} />
      </Suspense>
    </main>
  );
}

async function Workspace({ params }: Pick<PageProps<"/projects/[id]">, "params">) {
  const { id } = await params;
  const userId = await requireUserId();
  const project = z.uuid().safeParse(id).success ? await getProject(userId, id) : null;
  if (!project) notFound();
  const { stock } = project.document;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
      <p className="rounded-lg border p-4 text-muted-foreground">
        Stock {stock.width} × {stock.height} × {stock.thickness} mm. The workspace is coming soon.
      </p>
      <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground">
        ← All projects
      </Link>
    </>
  );
}
