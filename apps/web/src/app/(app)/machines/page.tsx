import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { requireUserId } from "@/features/auth/server";
import { MachineList } from "@/features/machines/components/machine-list";
import { listMachines } from "@/features/machines/server";

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
        <Machines />
      </Suspense>
    </main>
  );
}

async function Machines() {
  const machines = await listMachines(await requireUserId());
  return <MachineList machines={machines} />;
}
