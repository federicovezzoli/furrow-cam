"use client";

import { ChevronDownIcon, LogOutIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DeleteAccountDialog } from "@/components/delete-account-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

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
      <DropdownMenu>
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
          {/* Opened from outside the menu, so closing the menu doesn't unmount it. */}
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2Icon />
            Delete account…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
