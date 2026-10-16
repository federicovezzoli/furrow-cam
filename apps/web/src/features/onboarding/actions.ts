"use server";

import { z } from "zod";
import { getUserId } from "@/features/auth/server";
import { db } from "@/lib/db";

const TOUR_COLUMNS = {
  app: "appTourDoneAt",
  workspace: "workspaceTourDoneAt",
} as const;

const TourId = z.enum(["app", "workspace"]);

/**
 * Remembers on the account that the user finished or skipped a tour, so it
 * doesn't show again on any device. The first time is kept: replaying a tour
 * doesn't move it.
 */
export async function finishTour(tour: unknown): Promise<void> {
  const userId = await getUserId();
  const parsed = TourId.safeParse(tour);
  if (!userId || !parsed.success) return;
  const column = TOUR_COLUMNS[parsed.data];
  await db.user.updateMany({
    where: { id: userId, [column]: null },
    data: { [column]: new Date() },
  });
}
