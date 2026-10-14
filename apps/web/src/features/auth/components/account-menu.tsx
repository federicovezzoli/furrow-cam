"use client";

import { ChevronDownIcon, LogOutIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/features/auth/lib/auth-client";
import { DeleteAccountDialog } from "./delete-account-dialog";

/** The header's account menu: the signed-in email, account deletion and sign-out. */
export function AccountMenu({ email }: { email: string }) {
  const router = useRouter();
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
          <Button variant="outline" size="sm">
            Account
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={signOut}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2Icon />
            Delete account…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Outside the menu, so closing the menu doesn't unmount it. */}
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
