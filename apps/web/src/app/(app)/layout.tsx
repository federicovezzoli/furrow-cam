import { ThemeToggle } from "@furrow/ui/components/theme-toggle";
import Link from "next/link";
import { Suspense } from "react";
import { SiteFooter } from "@/components/site-footer";
import { requireSession } from "@/features/auth/server";
import { AppTour } from "@/features/onboarding/components/app-tour";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b">
        <nav className="flex w-full items-center gap-6 px-8 py-3 text-sm">
          <Link href="/projects" className="font-semibold tracking-tight">
            Furrow CAM
          </Link>
          <Link href="/projects" className="text-muted-foreground hover:text-foreground">
            Projects
          </Link>
          <Link
            href="/tools"
            data-tour="bits"
            className="text-muted-foreground hover:text-foreground"
          >
            Bits
          </Link>
          <Link
            href="/machines"
            data-tour="machines"
            className="text-muted-foreground hover:text-foreground"
          >
            Machines
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Suspense>
              <SignedInAccountMenu />
            </Suspense>
          </div>
        </nav>
      </header>
      {children}
      <SiteFooter />
    </>
  );
}

async function SignedInAccountMenu() {
  const { user } = await requireSession();
  return <AppTour userId={user.id} email={user.email} done={user.appTourDoneAt != null} />;
}
