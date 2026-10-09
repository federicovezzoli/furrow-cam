import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { getMachine, snapshotMachine } from "@/lib/machines";
import { requireUserId } from "@/lib/session";
import { MachineForm } from "../machine-form";

export default function EditMachinePage({ params }: PageProps<"/machines/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Edit machine</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EditMachine params={params} />
      </Suspense>
    </main>
  );
}

async function EditMachine({ params }: Pick<PageProps<"/machines/[id]">, "params">) {
  const { id } = await params;
  const userId = await requireUserId();
  const machine = z.uuid().safeParse(id).success ? await getMachine(userId, id) : null;
  if (!machine) notFound();

  return <MachineForm id={machine.id} values={snapshotMachine(machine)} />;
}
