"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import RefreshIcon from "@mui/icons-material/Refresh";

/**
 * The ONE sanctioned client-side fetch in this product: the slate polling
 * Sightline's own price-refresh route (RD-12). A bare interval, no
 * data-fetching library. The browser never talks to Kalshi — whether Kalshi
 * is contacted is the server's call, coalesced server-side (RD-13), so an
 * open tab cannot multiply outbound traffic.
 *
 * Paused while the tab is hidden: a slate left open overnight neither polls
 * nor writes. No snackbar on a routine refresh — the timestamp updating in
 * the header IS the feedback.
 */
export function SlatePoller({ intervalSeconds }: { intervalSeconds: number }) {
  const router = useRouter();
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      await fetch("/api/prices/refresh", { method: "POST" });
      router.refresh();
    } catch {
      // A failed poll is not an error surface; the banner and timestamps
      // already tell the truth about staleness on the next successful read.
    } finally {
      inFlight.current = false;
    }
  }, [router]);

  useEffect(() => {
    const id = window.setInterval(refresh, intervalSeconds * 1000);
    return () => window.clearInterval(id);
  }, [refresh, intervalSeconds]);

  return null;
}

/** The manual refresh control; shares the poller's exact path. */
export function RefreshPricesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    try {
      await fetch("/api/prices/refresh", { method: "POST" });
      router.refresh();
    } catch {
      // Same posture as the poller: the surface states tell the truth.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="text"
      size="small"
      startIcon={<RefreshIcon sx={{ fontSize: 20 }} />}
      onClick={onClick}
      disabled={busy}
      aria-label="Refresh prices"
    >
      Refresh prices
    </Button>
  );
}
