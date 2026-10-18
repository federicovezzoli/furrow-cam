"use client";

import { FormError } from "@furrow/ui/components/form-error";
import { Button } from "@furrow/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@furrow/ui/components/ui/dialog";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/features/auth/lib/auth-client";
import { PasswordField } from "./password-field";

/** Deletes the signed-in user's account after they confirm their password (#28). */
export function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { error } = await authClient.deleteUser({ password: String(form.get("password")) });
      if (error) return setError(error.message ?? "Could not delete the account.");
    } catch {
      return setError("Could not delete the account. Check your connection and try again.");
    } finally {
      setPending(false);
    }
    // The deletion signed the user out: close the dialog so it doesn't linger while navigating away.
    onOpenChange(false);
    router.push("/");
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        setError(null);
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            Your account, projects, bits and machines are deleted right away. This cannot be undone.
            Export the projects you want to keep first.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <PasswordField
            label="Password"
            id="delete-account-password"
            name="password"
            autoComplete="current-password"
          />
          <FormError message={error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
