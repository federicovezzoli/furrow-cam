import { Button } from "@furrow/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@furrow/ui/components/ui/table";
import { POST_PROCESSOR_LABELS } from "@furrow/workspace/machines/lib/labels";
import { PencilIcon } from "lucide-react";
import Link from "next/link";
import { DeleteButton } from "@/components/delete-button";
import { formatNumber, Unit } from "@/components/table-format";
import { deleteMachine } from "@/features/machines/actions";
import type { Machine as MachineRow } from "@/generated/prisma/client";

export function MachineList({ machines }: { machines: MachineRow[] }) {
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
            <TableHead className="text-right">
              Entry clearance<Unit>mm</Unit>
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
              <TableCell className="text-right">{formatNumber(machine.entryClearance)}</TableCell>
              <TableCell>{POST_PROCESSOR_LABELS[machine.postProcessor]}</TableCell>
              <TableCell className="pr-4">
                <div className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="icon-sm" title="Edit">
                    <Link href={`/machines/${machine.id}`} aria-label={`Edit ${machine.name}`}>
                      <PencilIcon />
                    </Link>
                  </Button>
                  <DeleteButton
                    name={machine.name}
                    // Projects keep their own snapshot of the machine, so deleting it is safe (ADR-0003).
                    confirmText={`Delete "${machine.name}"? Existing projects keep their copy of this machine.`}
                    action={deleteMachine.bind(null, machine.id)}
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
