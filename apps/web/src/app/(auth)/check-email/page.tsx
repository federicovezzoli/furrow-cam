import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@furrow/ui/components/ui/card";
import Link from "next/link";
import { getTranslator } from "@/lib/locale";

export default async function CheckEmailPage() {
  const t = await getTranslator();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Auth.checkEmailTitle")}</CardTitle>
        <CardDescription>{t("Auth.checkEmailBody")}</CardDescription>
      </CardHeader>
      <CardFooter className="text-sm text-muted-foreground">
        <Link href="/sign-in" className="underline">
          {t("Auth.backToSignIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
