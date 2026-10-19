import { GuestEntry } from "@/features/workspace/guest/guest-app";

/**
 * A new guest project, opened straight in the workspace: the website's
 * entry point (PRD-0008 G11). Signed-in users are sent to their projects by `proxy.ts`.
 */
export default function NewGuestProjectPage() {
  return <GuestEntry fresh />;
}
