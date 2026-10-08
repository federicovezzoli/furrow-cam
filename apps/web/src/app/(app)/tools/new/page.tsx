import { ToolForm } from "../tool-form";

export default function NewToolPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">New tool</h1>
      <ToolForm />
    </main>
  );
}
