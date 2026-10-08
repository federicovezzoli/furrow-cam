import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { getTool, snapshotTool } from "@/lib/tools";
import { ToolForm } from "../tool-form";

export default function EditToolPage({ params }: PageProps<"/tools/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Edit bit</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EditTool params={params} />
      </Suspense>
    </main>
  );
}

async function EditTool({ params }: Pick<PageProps<"/tools/[id]">, "params">) {
  const { id } = await params;
  const userId = await requireUserId();
  const tool = z.uuid().safeParse(id).success ? await getTool(userId, id) : null;
  if (!tool) notFound();

  return <ToolForm id={tool.id} values={snapshotTool(tool)} />;
}
