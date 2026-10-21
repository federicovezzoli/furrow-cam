import { NewMachine } from "@furrow/workspace/machines/components/new-machine";
import Link from "next/link";
import { saveMachine } from "@/features/machines/actions";
import { getTranslator } from "@/lib/locale";

export default async function NewMachinePage() {
  const t = await getTranslator();
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("Machines.newMachine")}</h1>
      <NewMachine
        save={saveMachine}
        cancel={<Link href="/machines">{t("Machines.cancel")}</Link>}
      />
    </main>
  );
}
