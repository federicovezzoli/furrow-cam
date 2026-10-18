import { Button } from "@furrow/ui/components/ui/button";
import { nextToolColor } from "@furrow/workspace/tools/lib/colors";
import type * as React from "react";
import { Suspense } from "react";
import { requireUserId } from "@/features/auth/server";
import { OpenToolButton, ToolDialogProvider } from "@/features/tools/components/library-dialog";
import { ToolList } from "@/features/tools/components/tool-list";
import { listTools } from "@/features/tools/server";

export default function ToolsPage() {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <ToolDialogProvider>
        <Suspense
          fallback={
            <>
              <Header action={<Button disabled>New bit</Button>} />
              <p className="text-muted-foreground">Loading…</p>
            </>
          }
        >
          <ToolLibrary />
        </Suspense>
      </ToolDialogProvider>
    </main>
  );
}

function Header({ action }: { action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">Bits library</h1>
      {action}
    </div>
  );
}

async function ToolLibrary() {
  const tools = await listTools(await requireUserId());
  return (
    <>
      <Header
        action={
          <OpenToolButton id={null} values={{ color: nextToolColor(tools) }}>
            New bit
          </OpenToolButton>
        }
      />
      <ToolList tools={tools} />
    </>
  );
}
