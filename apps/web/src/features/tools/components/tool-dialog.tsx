"use client";

import type * as React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SetBusyContext = createContext<(busy: boolean) => void>(() => {});

/**
 * The modal the bit form opens in, in the library and in the workspace. It
 * scrolls instead of overflowing on short or narrow screens, and can't be
 * dismissed while the form inside is saving (see `useToolDialogBusy`).
 */
export function ToolDialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <SetBusyContext value={setBusy}>{children}</SetBusyContext>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Keeps the surrounding `ToolDialog` open while `busy`, so a save in flight
 * can't land after the user thinks they cancelled it.
 */
export function useToolDialogBusy(busy: boolean) {
  const setBusy = useContext(SetBusyContext);
  useEffect(() => {
    setBusy(busy);
    return () => setBusy(false);
  }, [setBusy, busy]);
}
