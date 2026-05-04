"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { DashboardStatusPayload } from "@/app/api/dashboard/status/route";

/**
 * Surfaces important status transitions as toast notifications. Mounted
 * inside LiveAppShell so it sees the SWR-cached status payload via the
 * shared cache key (`/api/dashboard/status`).
 *
 * Currently watches:
 * - mode_change_pending: shows a persistent warning toast until restart
 * - paused / resumed transitions: brief info toast
 *
 * Add more watches here as the operator surfaces new failure modes.
 */

let lastPaused: boolean | null = null;
let lastModeChangePending: boolean | null = null;
let modeChangeToastId: string | number | null = null;

export function StatusWatcher({ status }: { status: DashboardStatusPayload | undefined }) {
  // Use a ref to avoid re-firing on prop identity changes when status hasn't
  // actually changed. The module-level flags above also dedupe across
  // remounts — sonner's toast IDs handle the actual rendering.
  const initialized = useRef(false);

  useEffect(() => {
    if (!status) return;

    // Skip the very first observation so we don't show a "resumed" toast
    // on initial page load.
    if (!initialized.current) {
      initialized.current = true;
      lastPaused = status.paused;
      lastModeChangePending = status.modeChangePending;
      if (status.modeChangePending) {
        modeChangeToastId = toast.warning("Mode change pending — restart required", {
          duration: Infinity,
          id: "mode-change-pending",
        });
      }
      return;
    }

    if (status.paused !== lastPaused) {
      if (status.paused) {
        toast.info("Trading paused");
      } else {
        toast.success("Trading resumed");
      }
      lastPaused = status.paused;
    }

    if (status.modeChangePending !== lastModeChangePending) {
      if (status.modeChangePending) {
        modeChangeToastId = toast.warning("Mode change pending — restart required", {
          duration: Infinity,
          id: "mode-change-pending",
        });
      } else if (modeChangeToastId != null) {
        toast.dismiss(modeChangeToastId);
        modeChangeToastId = null;
        toast.success("Mode change applied");
      }
      lastModeChangePending = status.modeChangePending;
    }
  }, [status]);

  return null;
}
