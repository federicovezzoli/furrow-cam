"use server";

import { z } from "zod";
import { getUserId } from "@/features/auth/server";
import { db } from "@/lib/db";
import type { TourId } from "./lib/tour";

/** The `User` column remembering each tour. */
const TOUR_COLUMNS = {
  app: "appTourDoneAt",
  workspace: "workspaceTourDoneAt",
} as const satisfies Record<TourId, string>;

const Tour = z.enum(Object.keys(TOUR_COLUMNS) as [TourId, ...TourId[]]);

/**
 * Remembers on the account that the user finished or skipped a tour, so it
 * doesn't show again on any device. The first time is kept: replaying a tour
 * doesn't move it.
 */
export async function finishTour(tour: unknown): Promise<void> {
  const userId = await getUserId();
  const parsed = Tour.safeParse(tour);
  if (!userId || !parsed.success) return;
  const column = TOUR_COLUMNS[parsed.data];
  await db.user.updateMany({
    where: { id: userId, [column]: null },
    data: { [column]: new Date() },
  });
}
