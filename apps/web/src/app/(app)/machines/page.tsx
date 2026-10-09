import { PencilIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listMachines } from "@/lib/machines";
import { requireUserId } from "@/lib/session";
import { DeleteMachineButton } from "./delete-machine-button";
import { POST_PROCESSOR_LABELS } from "./labels";

export default function MachinesPage() {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Machines</h1>
        <Button asChild>
          <Link href="/machines/new">New machine</Link>
        </Button>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <MachineList />
      </Suspense>
    </main>
  );
}

async function MachineList() {
  const machines = await listMachines(await requireUserId());
  if (machines.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-muted-foreground">
        No machines yet. Describe your router once, and pick it when you set up a project.
      </p>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="[&>th]:h-auto [&>th]:py-2 [&>th]:align-bottom">
            <TableHead className="pl-4">Name</TableHead>
            <TableHead className="text-right">
              Work area X × Y × Z<Unit>mm</Unit>
            </TableHead>
            <TableHead className="text-right">
              Max feed X/Y<Unit>mm/min</Unit>
            </TableHead>
            <TableHead className="text-right">
              Max feed Z<Unit>mm/min</Unit>
            </TableHead>
            <TableHead className="text-right">
              Spindle<Unit>RPM</Unit>
            </TableHead>
            <TableHead className="text-right">
              Safe Z<Unit>mm</Unit>
            </TableHead>
            <TableHead>Post-processor</TableHead>
            <TableHead className="pr-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          {machines.map((machine) => (
            <TableRow key={machine.id}>
              <TableCell className="pl-4">
                <Link href={`/machines/${machine.id}`} className="font-medium hover:underline">
                  {machine.name}
                </Link>
              </TableCell>
              <TableCell className="text-right">
                {[machine.workAreaX, machine.workAreaY, machine.workAreaZ]
                  .map(formatNumber)
                  .join(" × ")}
              </TableCell>
              <TableCell className="text-right">{formatNumber(machine.maxFeedXY)}</TableCell>
              <TableCell className="text-right">{formatNumber(machine.maxFeedZ)}</TableCell>
              <TableCell className="text-right">
                {machine.spindleRpmMin === null || machine.spindleRpmMax === null
                  ? "Manual"
                  : `${formatNumber(machine.spindleRpmMin)}–${formatNumber(machine.spindleRpmMax)}`}
              </TableCell>
              <TableCell className="text-right">{formatNumber(machine.safeZ)}</TableCell>
              <TableCell>{POST_PROCESSOR_LABELS[machine.postProcessor]}</TableCell>
              <TableCell className="pr-4">
                <div className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="icon-sm" title="Edit">
                    <Link href={`/machines/${machine.id}`} aria-label={`Edit ${machine.name}`}>
                      <PencilIcon />
                    </Link>
                  </Button>
                  <DeleteMachineButton id={machine.id} name={machine.name} />
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
