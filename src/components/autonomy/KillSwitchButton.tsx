"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * The kill switch.
 *
 * **No confirmation dialog.** Its purpose is to stop first and ask questions
 * later, and a dialog between the operator and a halt is exactly the wrong
 * thing under time pressure. Disengaging is confirmed; engaging is not.
 *
 * Two behaviours that matter more than they look:
 *
 * - It renders and works even when the surrounding page's read failed. The
 *   control that stops the bot must never be unavailable because a chart could
 *   not load.
 * - **A kill that did not take effect does not clear its pressed appearance.**
 *   It shows an inline error and stays looking engaged, because a control that
 *   looks like it worked and did not is the worst possible failure here.
 */
export function KillSwitchButton({ engaged }: { engaged: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [optimistic, setOptimistic] = useState(engaged);

  async function kill() {
    setPending(true);
    setFailed(false);
    setOptimistic(true);
    try {
      const response = await fetch("/api/autonomy/kill", { method: "POST" });
      if (!response.ok) throw new Error("kill failed");
      router.refresh();
    } catch {
      // Deliberately keeps `optimistic` true. The operator must see that the
      // control was pressed and did NOT take, not a button that quietly reset.
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  async function release() {
    if (
      !window.confirm(
        "Disengage the kill switch? Autonomous trading resumes only if no safety condition is active.",
      )
    ) {
      return;
    }
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/autonomy/kill/release", {
        method: "POST",
      });
      if (!response.ok) throw new Error("release failed");
      setOptimistic(false);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack spacing={1} sx={{ alignItems: { xs: "stretch", sm: "flex-end" } }}>
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          onClick={kill}
          disabled={optimistic || pending}
          aria-label="Kill autonomy: stop creating new simulated positions"
          sx={{ color: "error.main", borderColor: "error.main" }}
        >
          {optimistic ? "Killed" : "Kill autonomy"}
        </Button>
        {optimistic ? (
          <Button
            variant="outlined"
            size="small"
            onClick={release}
            disabled={pending}
          >
            Disengage kill switch
          </Button>
        ) : null}
      </Stack>
      {failed ? (
        <Typography variant="body2" sx={{ color: "error.main" }} role="alert">
          Kill did not take effect. Retry.
        </Typography>
      ) : null}
    </Stack>
  );
}
