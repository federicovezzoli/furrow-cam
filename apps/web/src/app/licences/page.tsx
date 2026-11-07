import { ThirdPartyLicences } from "@furrow/workspace/components/third-party-licences";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { getTranslator } from "@/lib/locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator())("Meta.licencesTitle") };
}

export default function LicencesPage() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-screen-md flex-1 flex-col gap-8 p-8 text-sm leading-relaxed">
        <Link href="/" className="font-semibold tracking-tight">
          Furrow CAM
        </Link>
        <ThirdPartyLicences />
      </main>
      <SiteFooter />
    </>
  );
}
