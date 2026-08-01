import Alert from "@mui/material/Alert";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { HealthStateChip } from "@/components/primitives/HealthStateChip";
import { NumericText } from "@/components/primitives/NumericText";
import type { HealthSignalDto } from "@/lib/dto/health";

/**
 * System health.
 *
 * Makes the freshness of Sightline's scheduled systems visible inside the
 * product rather than in a logs tab — and, in this pitch, says plainly that
 * none of them exists yet.
 *
 * Not an operations console: no logs, no feature flags, no job triggers, no
 * database tools, no deploy controls. Values are read on request; there is no
 * polling and no countdown.
 */
export function Health({ signals }: { signals: HealthSignalDto[] }) {
  const anyUnbuilt = signals.some((s) => s.state === "not_yet_implemented");

  return (
    <Stack spacing={3}>
      <Typography variant="h1">System health</Typography>

      {/*
        Conditional, not permanent: it disappears on its own once every signal
        is live, without anyone remembering to remove it.
      */}
      {anyUnbuilt ? (
        <Alert severity="info" icon={false}>
          Scheduled jobs are not part of this version. These signals report as
          unavailable until the live pipeline ships.
        </Alert>
      ) : null}

      <Paper>
        <List disablePadding>
          {signals.map((signal, index) => (
            <ListItem
              key={signal.key}
              divider={index < signals.length - 1}
              sx={{ display: "block", py: 2.5, px: 2, minHeight: 80 }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", justifyContent: "space-between" }}
              >
                <Typography variant="body1">{signal.label}</Typography>
                {/* Renders nothing when the signal is healthy. */}
                <HealthStateChip state={signal.state} />
              </Stack>

              <Row
                label="Last successful run"
                value={signal.lastSuccessAt}
                age={signal.lastSuccessAge}
              />
              {signal.expectedWithin ? (
                <Row label="Expected within" value={signal.expectedWithin} />
              ) : null}
              {signal.lastAttemptAt ? (
                <Row label="Last attempt" value={signal.lastAttemptAt} />
              ) : null}
            </ListItem>
          ))}
        </List>
      </Paper>
    </Stack>
  );
}

function Row({
  label,
  value,
  age,
}: {
  label: string;
  value: string | null;
  age?: string | null;
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        alignItems: "baseline",
        justifyContent: "space-between",
        mt: 0.5,
      }}
    >
      <Typography variant="label" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
        {/* An em dash, never a fabricated timestamp and never a zero date. */}
        <NumericText size="md" muted={!value}>
          {value ?? "—"}
        </NumericText>
        {age ? (
          <Typography
            variant="caption"
            sx={{ color: "text.muted", display: { xs: "none", sm: "inline" } }}
          >
            ({age})
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  );
}
