"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { EmptyState } from "@/components/primitives/EmptyState";
import { AutonomyHeading, BreachFacts } from "@/components/autonomy/primitives";
import type { ActiveBreachesDto } from "@/lib/dto/autonomy";

/**
 * Force Override.
 *
 * **A route, not a dialog.** A control that overrides a halt must not sit one
 * mis-tap away from the control that clears one, so this is a place the
 * operator goes rather than a button beside Resume.
 *
 * **Per-condition acknowledgement, not a generic "I understand".** Each
 * breached condition has its own checkbox, and all four of its facts —
 * condition, measured value, threshold, and when it tripped — render BEFORE
 * the action becomes available. A partial override is refused server-side too:
 * an unacknowledged condition would keep the campaign halted while the record
 * claimed the operator had accepted everything.
 *
 * The action is outlined, warning-toned, and deliberately not the visually
 * dominant element on the screen. It is never labelled "Resume".
 */
export function AutonomyOverride({ data }: { data: ActiveBreachesDto }) {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data.campaignExists || data.breaches.length === 0) {
    return (
      <Stack spacing={3}>
        <AutonomyHeading title="Force override" />
        <Paper>
          <EmptyState
            title="No active breach to override."
            detail="Force Override exists only while a safety condition is still breached. If a condition has cleared, use Resume on the overview instead."
            action={{ label: "Back to Autonomy", href: "/autonomy" }}
          />
        </Paper>
      </Stack>
    );
  }

  if (data.killSwitchEngaged) {
    return (
      <Stack spacing={3}>
        <AutonomyHeading title="Force override" />
        <Alert severity="error">
          The kill switch is engaged. Disengage it before resuming — a human
          halt outranks an override of a machine halt.
        </Alert>
        <Box>
          <Button variant="outlined" component={Link} href="/autonomy">
            Back to Autonomy
          </Button>
        </Box>
      </Stack>
    );
  }

  const allAcknowledged = data.breaches.every((breach) =>
    acknowledged.has(breach.id),
  );

  function toggle(id: string) {
    setAcknowledged((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/autonomy/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breachIds: [...acknowledged] }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "The override could not be recorded.");
      }
      router.push("/autonomy");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The override could not be recorded.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography
          component={Link}
          href="/autonomy"
          variant="body2"
          sx={{ color: "primary.main", textDecoration: "none" }}
        >
          ← Autonomy
        </Typography>
      </Box>
      <AutonomyHeading title="Force override" />

      <Alert severity="warning">
        Force override resumes autonomous trading while a safety condition is
        still breached. Ordinary Resume is not available because the condition
        has not cleared. The breaker remains active and will evaluate again on
        the next cycle — this does not disable it.
      </Alert>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Typography variant="h2">
        Active breaches — select each one you are overriding
      </Typography>

      <Stack spacing={1.5}>
        {data.breaches.map((breach) => (
          <Box
            key={breach.id}
            sx={{
              display: "flex",
              gap: 1.5,
              p: 2,
              border: 1,
              borderColor: "warning.main",
              backgroundColor: "warning.soft",
              borderRadius: 1,
            }}
          >
            <Checkbox
              checked={acknowledged.has(breach.id)}
              onChange={() => toggle(breach.id)}
              slotProps={{
                input: { "aria-label": `Override ${breach.label}` },
              }}
              sx={{ p: 0, mt: 0.25, alignSelf: "flex-start" }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="label" sx={{ display: "block", mb: 0.75 }}>
                {breach.label}
              </Typography>
              <BreachFacts breach={breach} />
            </Box>
          </Box>
        ))}
      </Stack>

      <Typography
        variant="body2"
        sx={{ color: "text.secondary", maxWidth: 680 }}
      >
        Autonomous trading will resume with these conditions still breached.
        Each override is recorded permanently against this campaign and appears
        in review.
      </Typography>

      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: "flex-end", alignItems: "center" }}
      >
        <Button variant="text" component={Link} href="/autonomy">
          Cancel
        </Button>
        <Button
          variant="outlined"
          onClick={submit}
          disabled={!allAcknowledged || pending}
          sx={{ color: "warning.main", borderColor: "warning.main" }}
        >
          Force override and resume
        </Button>
      </Stack>
      <Typography
        variant="caption"
        sx={{ color: "text.muted", textAlign: "right" }}
      >
        {acknowledged.size} of {data.breaches.length} breaches acknowledged.
      </Typography>
    </Stack>
  );
}
