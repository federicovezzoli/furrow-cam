import { GuestEntry } from "@/features/workspace/guest/guest-app";

/**
 * The workspace without an account (PRD-0008 G1, ADR-0050): opens the
 * guest's last project at its address under `/local`. Signed-in users are
 * sent to their projects by `proxy.ts`.
 */
export default function GuestPage() {
  return <GuestEntry />;
}
