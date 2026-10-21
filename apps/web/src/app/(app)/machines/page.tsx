import { Button } from "@furrow/ui/components/ui/button";
import Link from "next/link";
import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { requireUserId } from "@/features/auth/server";
import { MachineList } from "@/features/machines/components/machine-list";
import { listMachines } from "@/features/machines/server";
import { getTranslator } from "@/lib/locale";

export default async function MachinesPage() {
  const t = await getTranslator();
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Machines.title")}</h1>
        <Button asChild>
          <Link href="/machines/new">{t("Machines.newMachine")}</Link>
        </Button>
      </div>
      <Suspense fallback={<Loading />}>
        <Machines />
      </Suspense>
    </main>
  );
}

async function Machines() {
  const machines = await listMachines(await requireUserId());
  return <MachineList machines={machines} />;
}
