import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = { title: "Privacy policy · Furrow CAM" };

// Keep in sync with what we actually store and who processes it (ADR-0013, ADR-0020, ADR-0023, ADR-0029, ADR-0036, ADR-0049, ADR-0050).
const LAST_UPDATED = "19 October 2026";
const CONTACT = "privacy@furrow.cam";

export default function PrivacyPage() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-screen-md flex-1 flex-col gap-8 p-8 text-sm leading-relaxed">
        <header className="grid gap-2">
          <Link href="/" className="font-semibold tracking-tight">
            Furrow CAM
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Privacy policy</h1>
          <p className="text-muted-foreground">Last updated {LAST_UPDATED}</p>
        </header>

        <Section title="Who we are">
          <p>
            Furrow CAM is an open source project run by Federico Vezzoli, who is responsible for the
            personal data described here. For questions or requests about your data, write to{" "}
            <Mail />.
          </p>
        </Section>

        <Section title="What we store">
          <p>The only thing we ask you for is your email address. With your account we store:</p>
          <List>
            <li>
              <strong>Your email address</strong>, to sign you in and to send you verification and
              password reset emails. We don't send newsletters or marketing.
            </li>
            <li>
              <strong>A hash of your password</strong>, never the password itself.
            </li>
            <li>
              <strong>Your sessions</strong>: for each device you sign in on, its IP address and
              browser user agent, so suspicious sign-ins can be spotted. A session is deleted when
              you sign out and expires after 7 days without use.
            </li>
            <li>
              <strong>Your projects, bits and machines</strong>: imported drawings and 3D models,
              operations and settings. Toolpaths and G-code are computed in your browser and never
              sent to us.
            </li>
            <li>
              <strong>When you first finished or skipped each guided tour</strong>, so it isn&apos;t
              shown to you again on another device.
            </li>
          </List>
          <p>
            We don't collect your name, a profile picture or any other personal details, and we
            don't use tracking cookies. The app sets a cookie for your session and one that
            remembers the workspace panel sizes, and keeps your light or dark theme choice in your
            browser&apos;s local storage.
          </p>
        </Section>

        <Section title="Using Furrow CAM without an account">
          <p>
            You can use Furrow CAM without signing up. Your projects, their 3D model files and your
            workspace settings are then kept in your browser&apos;s storage (IndexedDB) on your
            device, and are never sent to us. They reach our servers only if you create an account
            and choose to import them into it.
          </p>
          <p>
            You can delete them from the project list, or all at once by clearing this site&apos;s
            data in your browser. Clearing it, or using a private window, also loses them, so export
            the projects you want to keep.
          </p>
        </Section>

        <Section title="Why we process it">
          <List>
            <li>
              Your account data, sessions and projects: to provide the service you signed up for
              (performance of a contract).
            </li>
            <li>
              Request logs, page-view and download counts: to keep the service secure and working
              and to understand how it is used (legitimate interest).
            </li>
          </List>
        </Section>

        <Section title="Who processes it for us">
          <List>
            <li>
              <External href="https://vercel.com/legal/privacy-policy">Vercel</External> hosts the
              app, with its servers in Frankfurt (fra1). Its request logs include your IP address,
              user agent and the pages you request.
            </li>
            <li>
              <External href="https://neon.com/privacy-policy">Neon</External> hosts our database,
              in Frankfurt (AWS eu-central-1).
            </li>
            <li>
              <External href="https://www.cloudflare.com/privacypolicy/">Cloudflare</External>{" "}
              stores the 3D model files you import (Cloudflare R2), in a bucket restricted to the
              European Union. They are only reachable through short-lived links the app gives you.
              It also runs the desktop app&apos;s download links (download.furrow.cam): it receives
              your IP address and user agent with the request, and we keep only a count per system
              and version, for three months. The installer itself is downloaded from GitHub.
            </li>
            <li>
              <External href="https://resend.com/legal/privacy-policy">Resend</External> sends our
              emails, so it sees your email address and the content of those emails.
            </li>
            <li>
              <External href="https://www.goatcounter.com/help/privacy">GoatCounter</External>{" "}
              (goatcounter.com) counts page views, without cookies. It receives the page&apos;s
              route without any IDs (e.g. <code>/projects/[id]</code>), the website you came from
              (domain only, on your first page view), your screen size, and, with the request, your
              IP address and user agent. It uses these for country and browser statistics and
              doesn&apos;t store your IP address. Page views are not linked to your account.
            </li>
            <li>
              <External href="https://haveibeenpwned.com/Privacy">Have I Been Pwned</External>{" "}
              checks whether a new password appears in known data breaches when you sign up or reset
              your password. Our server sends it only the first 5 characters of the password&apos;s
              SHA-1 hash, shared by hundreds of other passwords, and does the comparison itself.
              Neither your password, your email address nor your IP address is sent.
            </li>
          </List>
          <p>
            These providers may process data outside the European Union; their privacy policies
            describe the safeguards they use. We don&apos;t sell your data or share it with anyone
            else.
          </p>
        </Section>

        <Section title="Exporting your data">
          <p>
            You can export each project as a file from the projects page or the editor, and import
            it again here or elsewhere. For a copy of any other data we hold about you, write to{" "}
            <Mail />.
          </p>
        </Section>

        <Section title="Deleting your account">
          <p>
            You can delete your account at any time from the Account menu in the app header, after
            confirming your password. Deletion is immediate and permanent: your email address,
            password hash, sessions, projects, bits and machines are removed from our database, and
            your 3D model files from our file storage. Deleting a project deletes its files too.
            Copies in our providers&apos; logs and backups are deleted on their own schedules.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            Under the GDPR you can ask to access, correct, delete or export your personal data, to
            restrict or object to its processing, and you can complain to your data protection
            authority. Write to <Mail /> and we will answer within a month.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            When this policy changes we update the date at the top. Its history is public in the{" "}
            <External href="https://github.com/federicovezzoli/furrow-cam">
              GitHub repository
            </External>
            .
          </p>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="grid list-disc gap-2 pl-5">{children}</ul>;
}

function Mail() {
  return (
    <a href={`mailto:${CONTACT}`} className="underline">
      {CONTACT}
    </a>
  );
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
      {children}
    </a>
  );
}
