import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Furrow CAM</h1>
      <p className="text-muted-foreground">Open source, web-based 2.5D CAM for CNC routers.</p>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/sign-up">Create an account</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
