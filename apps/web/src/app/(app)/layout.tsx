import { LanguagePicker } from "@furrow/ui/components/language-picker";
import { Logo } from "@furrow/ui/components/logo";
import { ThemeToggle } from "@furrow/ui/components/theme-toggle";
import { Button } from "@furrow/ui/components/ui/button";
import Link from "next/link";
import { Suspense } from "react";
import { NavLink } from "@/components/nav-link";
import { SiteFooter } from "@/components/site-footer";
import { getSession } from "@/features/auth/server";
import { AppTour } from "@/features/onboarding/components/app-tour";
import { getTranslator } from "@/lib/locale";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // The root layout's Suspense holds this request data.
  const t = await getTranslator();
  return (
    <>
      <header className="border-b">
        <nav className="flex w-full items-center gap-3 px-8 py-3 text-sm">
          <Link
            href="/projects"
            className="mr-3 flex items-center gap-2.5 font-semibold tracking-tight"
          >
            <Logo />
            Furrow CAM
          </Link>
          <NavLink href="/projects">{t("Nav.projects")}</NavLink>
          <Suspense>
            <AccountNav />
          </Suspense>
        </nav>
      </header>
      {children}
      <SiteFooter />
    </>
  );
}

/**
 * The account's pages and menu, or Sign in without an account (PRD-0008 G9):
 * guests' projects are kept in the browser, and bits and machines need an account.
 */
async function AccountNav() {
  const [session, t] = await Promise.all([getSession(), getTranslator()]);
  if (!session) {
    return (
      <div className="ml-auto flex items-center gap-2">
        <LanguagePicker />
        <ThemeToggle />
        <Button size="sm" variant="outline" asChild>
          <Link href="/sign-in">{t("Nav.signIn")}</Link>
        </Button>
      </div>
    );
  }
  const { user } = session;
  return (
    <>
      <NavLink href="/tools" data-tour="bits">
        {t("Nav.bits")}
      </NavLink>
      <NavLink href="/machines" data-tour="machines">
        {t("Nav.machines")}
      </NavLink>
      <div className="ml-auto flex items-center gap-2">
        <LanguagePicker />
        <ThemeToggle />
        <AppTour userId={user.id} email={user.email} done={user.appTourDoneAt != null} />
      </div>
    </>
  );
}
