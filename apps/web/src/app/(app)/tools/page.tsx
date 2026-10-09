import type { Tool } from "@furrow/document";
import { PencilIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { DeleteButton } from "@/components/delete-button";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUserId } from "@/lib/session";
import { listTools } from "@/lib/tools";
import { deleteTool } from "./actions";
import { BitTypeIcon } from "./bit-type-icon";
import { CUT_DIRECTION_LABELS, TOOL_TYPE_LABELS } from "./labels";
import { SetDefaultButton } from "./set-default-button";

export default function ToolsPage() {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bits library</h1>
        <Button asChild>
          <Link href="/tools/new">New bit</Link>
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
        No bits yet. Add the bits you cut with, and pick them when you create operations.
      </p>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="[&>th]:h-auto [&>th]:py-2 [&>th]:align-bottom">
            <TableHead className="pl-4">Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">
              Ø<Unit>mm</Unit>
            </TableHead>
            <TableHead className="text-right">Flutes</TableHead>
            <TableHead className="text-right">
              Flute length
              <Unit>mm</Unit>
            </TableHead>
            <TableHead>Cut / angle</TableHead>
            <TableHead className="text-right">
              Spindle
              <Unit>RPM</Unit>
            </TableHead>
            <TableHead className="text-right">
              Feed
              <Unit>mm/min</Unit>
            </TableHead>
            <TableHead className="text-right">
              Plunge
              <Unit>mm/min</Unit>
            </TableHead>
            <TableHead className="text-right">
              Step down
              <Unit>mm</Unit>
            </TableHead>
            <TableHead className="text-right">
              Step over
              <Unit>mm</Unit>
            </TableHead>
            <TableHead className="pr-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          {tools.map((tool) => (
            <TableRow key={tool.id}>
              <TableCell className="pl-4">
                <div className="flex items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-full border"
                    style={{ backgroundColor: tool.color }}
                    aria-hidden="true"
                  />
                  <Link href={`/tools/${tool.id}`} className="font-medium hover:underline">
                    {tool.name}
                  </Link>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <BitTypeIcon type={tool.type} className="h-7 w-3.5 text-muted-foreground" />
                  {TOOL_TYPE_LABELS[tool.type]}
                </div>
              </TableCell>
              <TableCell className="text-right">{formatNumber(tool.diameter)}</TableCell>
              <TableCell className="text-right">{tool.fluteCount}</TableCell>
              <TableCell className="text-right">{formatNumber(tool.fluteLength)}</TableCell>
              <TableCell>{describeCut(tool)}</TableCell>
              <TableCell className="text-right">{formatNumber(tool.spindleRpm)}</TableCell>
              <TableCell className="text-right">{formatNumber(tool.feedRate)}</TableCell>
              <TableCell className="text-right">{formatNumber(tool.plungeRate)}</TableCell>
              <TableCell className="text-right">{formatNumber(tool.stepDown)}</TableCell>
              <TableCell className="text-right">
                {formatNumber((tool.diameter * tool.stepOver) / 100)}{" "}
                <span className="text-muted-foreground">({formatNumber(tool.stepOver)}%)</span>
              </TableCell>
              <TableCell className="pr-4">
                <div className="flex justify-end gap-1">
                  <SetDefaultButton id={tool.id} name={tool.name} isDefault={tool.isDefault} />
                  <Button asChild variant="ghost" size="icon-sm" title="Edit">
                    <Link href={`/tools/${tool.id}`} aria-label={`Edit ${tool.name}`}>
                      <PencilIcon />
                    </Link>
                  </Button>
                  <DeleteButton
                    name={tool.name}
                    // Projects keep their own snapshot of the tool, so deleting it is safe (ADR-0003).
                    confirmText={`Delete "${tool.name}"? Existing projects keep their copy of this bit.`}
                    action={deleteTool.bind(null, tool.id)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Unit({ children }: { children: string }) {
  return <span className="block text-xs font-normal text-muted-foreground">{children}</span>;
}

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Cut direction for end mills, angle and tip for V-bits, nothing for drills. */
function describeCut(tool: Tool): string {
  if (tool.cutDirection) return CUT_DIRECTION_LABELS[tool.cutDirection];
  if (tool.vAngle === null) return "—";
  const tip = tool.tipDiameter ? ` · ${formatNumber(tool.tipDiameter)} mm tip` : "";
  return `${formatNumber(tool.vAngle)}°${tip}`;
}
