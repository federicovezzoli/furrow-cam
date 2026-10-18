"use client";

import { usePathname } from "next/navigation";
import { AccountMenu } from "@/features/auth/components/account-menu";
import { finishTour } from "@/features/onboarding/actions";
import { Tour, useTour } from "./tour";

/**
 * The header's account menu with the app tour (PRD-0001 R22): it starts on
 * the first visit to the project list, unless the account finished it
 * (`done`), and the menu replays it on any page.
 */
export function AppTour({ userId, email, done }: { userId: string; email: string; done: boolean }) {
  const tour = useTour("app", {
    userId,
    done,
    autoStart: usePathname() === "/projects",
    finish: finishTour,
  });
  return (
    <>
      <AccountMenu email={email} onTakeTour={tour.start} />
      <Tour id="app" running={tour.running} origin={tour.origin} onEnd={tour.end} />
    </>
  );
}
