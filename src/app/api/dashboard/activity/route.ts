import { NextResponse } from "next/server";
import {
  getActiveActivities,
  getRecentActivities,
  type ActivityEntry,
} from "@/lib/activity/tracker";

/**
 * Live activity feed. Polled by the header `<ActivityIndicator />` every
 * couple of seconds. No DB I/O — the tracker is in-memory — so this is
 * cheap and safe to hit at high frequency.
 *
 * Auth-skipped: the activity feed is read-only summary data and the header
 * polls it pre-auth on the login page too. (Promote to safeDashboardHandler
 * if you ever surface sensitive detail.)
 */

export interface ActivityPayload {
  active: ActivityEntry[];
  recent: ActivityEntry[];
  serverTime: string;
}

export async function GET() {
  const payload: ActivityPayload = {
    active: getActiveActivities(),
    recent: getRecentActivities(20),
    serverTime: new Date().toISOString(),
  };
  return NextResponse.json(payload);
}
