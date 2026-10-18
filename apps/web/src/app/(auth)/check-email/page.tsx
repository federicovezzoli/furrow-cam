import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@furrow/ui/components/ui/card";
import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We've sent you a link to verify your email address. Open it to finish signing up.
        </CardDescription>
      </CardHeader>
      <CardFooter className="text-sm text-muted-foreground">
        <Link href="/sign-in" className="underline">
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
