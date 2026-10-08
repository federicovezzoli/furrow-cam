import type { Tool } from "@furrow/document";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { requireUserId } from "@/lib/session";
import { listTools } from "@/lib/tools";
import { DeleteToolButton } from "./delete-tool-button";
import { CUT_DIRECTION_LABELS, TOOL_TYPE_LABELS } from "./labels";

export default function ToolsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Tool library</h1>
        <Button asChild>
          <Link href="/tools/new">New tool</Link>
        </Button>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <ToolList />
      </Suspense>
    </main>
  );
}

async function ToolList() {
  const tools = await listTools(await requireUserId());
  if (tools.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-muted-foreground">
        No tools yet. Add the bits you cut with, and pick them when you create operations.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border">
      {tools.map((tool) => (
        <li key={tool.id} className="flex items-center justify-between gap-4 p-4">
          <div className="grid gap-1">
            <Link href={`/tools/${tool.id}`} className="font-medium hover:underline">
              {tool.name}
            </Link>
            <p className="text-sm text-muted-foreground">{describeGeometry(tool)}</p>
            <p className="text-sm text-muted-foreground">{describeCuttingData(tool)}</p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/tools/${tool.id}`}>Edit</Link>
            </Button>
            <DeleteToolButton id={tool.id} name={tool.name} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function describeGeometry(tool: Tool): string {
  return [
    TOOL_TYPE_LABELS[tool.type],
    `Ø ${tool.diameter} mm`,
    tool.vAngle === null ? null : `${tool.vAngle}°`,
    tool.tipDiameter ? `${tool.tipDiameter} mm tip` : null,
    `${tool.fluteCount} ${tool.fluteCount === 1 ? "flute" : "flutes"}`,
    `${tool.fluteLength} mm flute length`,
    tool.cutDirection && CUT_DIRECTION_LABELS[tool.cutDirection],
  ]
    .filter(Boolean)
    .join(" · ");
}

function describeCuttingData(tool: Tool): string {
  const stepOver = Math.round(tool.diameter * tool.stepOver) / 100;
  return [
    `${tool.spindleRpm} RPM`,
    `${tool.feedRate} mm/min feed`,
    `${tool.plungeRate} mm/min plunge`,
    `${tool.stepDown} mm step down`,
    `${stepOver} mm (${tool.stepOver}%) step over`,
  ].join(" · ");
}
