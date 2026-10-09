import type { Stock } from "@furrow/document";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormError } from "@/components/auth/form-error";
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
  const project = await getProject(userId, id);
  if (!project) notFound();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
      {project.error === undefined ? (
        <StockSummary stock={project.document.stock} />
      ) : (
        // Retrying can't fix a document this release can't read, so don't fall into error.tsx.
        <FormError message={project.error} />
      )}
      <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground">
        ← All projects
      </Link>
    </>
  );
}

function StockSummary({ stock }: { stock: Stock }) {
  return (
    <p className="rounded-lg border p-4 text-muted-foreground">
      Stock {stock.width} × {stock.height} × {stock.thickness} mm. The workspace is coming soon.
    </p>
  );
}
