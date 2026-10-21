import { Button } from "@furrow/ui/components/ui/button";
import { nextToolColor } from "@furrow/workspace/tools/lib/colors";
import type * as React from "react";
import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { requireUserId } from "@/features/auth/server";
import { OpenToolButton, ToolDialogProvider } from "@/features/tools/components/library-dialog";
import { ToolList } from "@/features/tools/components/tool-list";
import { listTools } from "@/features/tools/server";
import { getTranslator } from "@/lib/locale";

export default async function ToolsPage() {
  const t = await getTranslator();
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <ToolDialogProvider>
        <Suspense
          fallback={
            <>
              <Header
                title={t("Tools.title")}
                action={<Button disabled>{t("Tools.newBit")}</Button>}
              />
              <Loading />
            </>
          }
        >
          <ToolLibrary />
        </Suspense>
      </ToolDialogProvider>
    </main>
  );
}

function Header({ title, action }: { title: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {action}
    </div>
  );
}

async function ToolLibrary() {
  const [tools, t] = await Promise.all([requireUserId().then(listTools), getTranslator()]);
  return (
    <>
      <Header
        title={t("Tools.title")}
        action={
          <OpenToolButton id={null} values={{ color: nextToolColor(tools) }}>
            {t("Tools.newBit")}
          </OpenToolButton>
        }
      />
      <ToolList tools={tools} />
    </>
  );
}
