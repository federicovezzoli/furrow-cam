import { machineFields } from "@furrow/document";
import { MachineForm } from "@furrow/workspace/machines/components/machine-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Loading } from "@/components/loading";
import { requireUserId } from "@/features/auth/server";
import { saveMachine } from "@/features/machines/actions";
import { getMachine } from "@/features/machines/server";
import { getTranslator } from "@/lib/locale";

export default async function EditMachinePage({ params }: PageProps<"/machines/[id]">) {
  const t = await getTranslator();
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("Machines.editMachine")}</h1>
      <Suspense fallback={<Loading />}>
        <EditMachine params={params} />
      </Suspense>
    </main>
  );
}

async function EditMachine({ params }: Pick<PageProps<"/machines/[id]">, "params">) {
  const { id } = await params;
  const [userId, t] = await Promise.all([requireUserId(), getTranslator()]);
  const machine = z.uuid().safeParse(id).success ? await getMachine(userId, id) : null;
  if (!machine) notFound();

  // Copies the values without validating them. If a rule got stricter after this machine was
  // saved (e.g. a new RPM cap), validating here would crash the page and the user couldn't fix
  // the value. Instead the form shows it, and saving reports the error on the field.
  return (
    <MachineForm
      id={machine.id}
      values={machineFields(machine)}
      save={saveMachine}
      cancel={<Link href="/machines">{t("Machines.cancel")}</Link>}
    />
  );
}
