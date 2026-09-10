"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import RefreshIcon from "@mui/icons-material/Refresh";

/** Stored prices are stale once older than the on-view freshness threshold. */
function pricesAreStale(
  pricesUpdatedAt: string | null,
  freshnessSeconds: number,
): boolean {
  if (!pricesUpdatedAt) return true;
  const observed = Date.parse(pricesUpdatedAt);
  if (Number.isNaN(observed)) return true;
  return Date.now() - observed > freshnessSeconds * 1000;
}

/**
 * The ONE sanctioned client-side fetch in this product: the slate triggering
 * Sightline's own price-refresh route (RD-12). The browser never talks to
 * Kalshi — whether Kalshi is contacted is the server's call, coalesced and
 * advisory-locked server-side, so open tabs cannot multiply outbound traffic.
 *
 * Automatic price refresh (Pitch 10): the PRIMARY path is on-view — on mount
 * and whenever the tab is refocused, a freshness-gated refresh fires only if
 * the freshest stored price is older than `freshnessSeconds`. A bare interval
 * remains as a while-open backstop; both are paused while the tab is hidden, so
 * a slate left open overnight neither polls nor writes. No snackbar on a
 * routine refresh — the timestamp updating in the header IS the feedback. There
 * is no manual control here for viewers; manual refresh is an admin diagnostic.
 */
export function SlatePoller({
  intervalSeconds,
  pricesUpdatedAt = null,
  freshnessSeconds = 300,
}: {
  intervalSeconds: number;
  pricesUpdatedAt?: string | null;
  freshnessSeconds?: number;
}) {
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

  // On-view: refresh on mount and on return-to-tab, but only when the stored
  // price has actually gone stale — a page nobody is looking at, or one already
  // current, does not trigger Kalshi on its behalf.
  useEffect(() => {
    const maybeRefresh = () => {
      if (
        document.visibilityState === "visible" &&
        pricesAreStale(pricesUpdatedAt, freshnessSeconds)
      ) {
        void refresh();
      }
    };
    maybeRefresh();
    document.addEventListener("visibilitychange", maybeRefresh);
    return () => document.removeEventListener("visibilitychange", maybeRefresh);
  }, [refresh, pricesUpdatedAt, freshnessSeconds]);

  // Backstop while the tab stays open; server coalescing keeps it cheap.
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
