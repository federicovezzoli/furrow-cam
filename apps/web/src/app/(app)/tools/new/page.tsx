import { Suspense } from "react";
import { requireUserId } from "@/lib/session";
import { listTools, nextToolColor } from "@/lib/tools";
import { ToolForm } from "../tool-form";

export default function NewToolPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">New tool</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <NewTool />
      </Suspense>
    </main>
  );
}

async function NewTool() {
  const tools = await listTools(await requireUserId());
  return <ToolForm values={{ color: nextToolColor(tools) }} />;
}
