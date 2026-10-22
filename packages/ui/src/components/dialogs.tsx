"use client";

import type * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "use-intl";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** In-app replacements for `window.alert`, `confirm` and `prompt`, each settling once the user answers. */
export type Dialogs = {
  alert(message: string): Promise<void>;
  /** Whether the user agreed; `destructive` makes the button a red "Delete". */
  confirm(message: string, options?: { destructive?: boolean }): Promise<boolean>;
  /** A new name, or null when cancelled. */
  prompt(label: string, initial?: string): Promise<string | null>;
};

type Request = {
  id: number;
  kind: "alert" | "confirm" | "prompt";
  message: string;
  initial?: string;
  destructive?: boolean;
  /** The text submitted (empty unless prompting), or null when cancelled. */
  resolve(answer: string | null): void;
};

/** Queues `request`; `cancel` answers it as cancelled and takes it off the screen. */
type AskFn = (request: Omit<Request, "id" | "resolve">) => {
  answer: Promise<string | null>;
  cancel(): void;
};

const DialogsContext = createContext<AskFn | null>(null);

/** Shows what `useDialogs` asks, one at a time, over a full-page overlay. Mount it once, inside the `LocaleProvider`. */
export function DialogsProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const next = useRef(0);
  const ask = useCallback<AskFn>((request) => {
    const id = next.current++;
    let resolve: (answer: string | null) => void = () => {};
    const answer = new Promise<string | null>((settle) => {
      resolve = settle;
    });
    setQueue((queue) => [...queue, { ...request, id, resolve }]);
    return {
      answer,
      cancel: () => {
        resolve(null);
        setQueue((queue) => queue.filter((queued) => queued.id !== id));
      },
    };
  }, []);
  const current = queue[0];
  return (
    <DialogsContext.Provider value={ask}>
      {children}
      {current && (
        <Ask
          key={current.id}
          request={current}
          onAnswer={(answer) => {
            current.resolve(answer);
            setQueue((queue) => queue.filter((queued) => queued.id !== current.id));
          }}
        />
      )}
    </DialogsContext.Provider>
  );
}

/**
 * Asks as `window.alert`, `confirm` and `prompt` would; throws outside a
 * `DialogsProvider`. What is still open when the component unmounts (e.g. the
 * user went Back meanwhile) is answered as cancelled, so it can't act on a
 * page that's gone.
 */
export function useDialogs(): Dialogs {
  const ask = useContext(DialogsContext);
  const [pending] = useState(() => new Set<() => void>());
  useEffect(
    () => () => {
      for (const cancel of pending) cancel();
    },
    [pending],
  );
  return useMemo<Dialogs>(() => {
    if (!ask) throw new Error("useDialogs needs a DialogsProvider");
    const tracked = (request: Omit<Request, "id" | "resolve">) => {
      const { answer, cancel } = ask(request);
      pending.add(cancel);
      return answer.finally(() => pending.delete(cancel));
    };
    return {
      alert: async (message) => void (await tracked({ kind: "alert", message })),
      confirm: async (message, options) =>
        (await tracked({ kind: "confirm", message, ...options })) !== null,
      prompt: (message, initial = "") => tracked({ kind: "prompt", message, initial }),
    };
  }, [ask, pending]);
}

function Ask({
  request: { kind, message, initial, destructive },
  onAnswer,
}: {
  request: Request;
  onAnswer: (answer: string | null) => void;
}) {
  const t = useTranslations("Dialog");
  const [value, setValue] = useState(initial ?? "");
  const input = useRef<HTMLInputElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open onOpenChange={(open) => !open && onAnswer(null)}>
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby={undefined}
        // Enter answers yes: the input or the action has focus, not Cancel.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.select();
          (input.current ?? submit.current)?.focus();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onAnswer(kind === "prompt" ? value : "");
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-normal whitespace-pre-line">
              {message}
            </AlertDialogTitle>
          </AlertDialogHeader>
          {kind === "prompt" && (
            <Input
              ref={input}
              aria-label={message}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          <AlertDialogFooter>
            {kind !== "alert" && <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>}
            <Button ref={submit} type="submit" variant={destructive ? "destructive" : "default"}>
              {kind === "prompt" ? t("rename") : destructive ? t("delete") : t("ok")}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
