import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Furrow CAM
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
