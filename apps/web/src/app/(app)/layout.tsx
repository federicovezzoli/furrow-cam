import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";

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
          <Link href="/tools" className="text-muted-foreground hover:text-foreground">
            Bits
          </Link>
          <Link href="/machines" className="text-muted-foreground hover:text-foreground">
            Machines
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </nav>
      </header>
      {children}
    </>
  );
}
