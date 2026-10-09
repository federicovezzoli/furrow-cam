import { MachineForm } from "../machine-form";

export default function NewMachinePage() {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">New machine</h1>
      <MachineForm />
    </main>
  );
}
