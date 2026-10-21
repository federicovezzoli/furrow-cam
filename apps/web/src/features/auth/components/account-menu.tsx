"use client";

import { Button } from "@furrow/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@furrow/ui/components/ui/dropdown-menu";
import { ChevronDownIcon, CircleHelpIcon, LogOutIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { authClient } from "@/features/auth/lib/auth-client";
import { DeleteAccountDialog } from "./delete-account-dialog";

/**
 * The header's account menu: the signed-in email, the guided tour
 * (`onTakeTour` replays it, given the menu's button to give focus back to),
 * account deletion and sign-out.
 */
export function AccountMenu({
  email,
  onTakeTour,
}: {
  email: string;
  onTakeTour?: (trigger: HTMLElement | null) => void;
}) {
  const t = useTranslations("AccountMenu");
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <>
      {/* Not modal: a modal menu closing while the dialog opens can leave the page unclickable. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="outline" size="sm">
            {t("account")}
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {onTakeTour && (
            <DropdownMenuItem onSelect={() => onTakeTour(trigger.current)}>
              <CircleHelpIcon />
              {t("takeTour")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={signOut}>
            <LogOutIcon />
            {t("signOut")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2Icon />
            {t("deleteAccount")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Outside the menu, so closing the menu doesn't unmount it. */}
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
