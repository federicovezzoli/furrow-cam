import { ThemeToggle } from "@furrow/ui/components/theme-toggle";
import type * as React from "react";
import packageJson from "../../../package.json";
import type { Page } from "./desktop-host";

const REPOSITORY_URL = "https://github.com/federicovezzoli/furrow-cam";
// Changesets tags each release `<package>@<version>` (ADR-0012).
const RELEASE_URL = `${REPOSITORY_URL}/releases/tag/${encodeURIComponent(`@furrow/desktop@${packageJson.version}`)}`;
const AUTHOR_URL = "https://federicovezzoli.com";

/**
 * The navbar and footer around every page outside the workspace, as in the
 * web app. The workspace stays full-window.
 */
export function AppFrame({
  navigate,
  children,
}: {
  navigate: (page: Page) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <nav className="flex w-full items-center gap-6 px-8 py-3 text-sm">
          <NavButton onClick={() => navigate({ name: "start" })} brand>
            Furrow CAM
          </NavButton>
          <NavButton onClick={() => navigate({ name: "start" })}>Projects</NavButton>
          <NavButton onClick={() => navigate({ name: "tools" })}>Bits</NavButton>
          <NavButton onClick={() => navigate({ name: "machines" })}>Machines</NavButton>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </nav>
      </header>
      {children}
      <SiteFooter />
    </div>
  );
}

function NavButton({
  onClick,
  brand = false,
  children,
}: {
  onClick: () => void;
  brand?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        brand ? "font-semibold tracking-tight" : "text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

// Lucide has no brand icons; this is GitHub's mark (Octicons `mark-github`).
function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-3.5">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

/** Opens in the system browser: the app itself never goes online (ADR-0044). */
function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
    >
      {children}
    </a>
  );
}

/** The web app's footer, without the privacy page: the desktop app collects no data. */
function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-8 py-3 text-xs text-muted-foreground">
        <ExternalLink href={RELEASE_URL}>v{packageJson.version}</ExternalLink>
        <ExternalLink href={REPOSITORY_URL}>
          <GitHubIcon />
          GitHub
        </ExternalLink>
        {/* The project's start year, deliberately not computed at runtime. */}
        <span>
          © 2026 <ExternalLink href={AUTHOR_URL}>Federico Vezzoli</ExternalLink>
        </span>
      </div>
    </footer>
  );
}
