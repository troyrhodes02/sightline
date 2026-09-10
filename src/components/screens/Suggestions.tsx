"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

export type SuggestionListItem = {
  id: string;
  source: string;
  claimValue: string;
  subjectPlayerName: string;
  targetPlayerName: string;
  statType: string;
  status: string;
  evidenceText: string;
  reasonText: string;
  raisedAt: string;
  materialityKind: string;
  materialThresholdPp: number | null;
  materialRelativePct: number | null;
};

export type Rate = {
  numerator: number;
  denominator: number;
  rate: number | null;
};

export type SourceReliabilityDto = {
  source: string;
  sourceAccuracy: Rate;
  adjustmentAccuracy: Rate;
  adjustmentBreakdown: { improved: number; hurt: number; neutral: number };
  minSample: number;
};

const mono = { fontVariantNumeric: "tabular-nums" as const };

function statLabel(statType: string): string {
  return statType.replace(/_/g, " ");
}

export function Suggestions({
  pending,
  history,
  reliability,
}: {
  pending: SuggestionListItem[];
  history: SuggestionListItem[];
  reliability: SourceReliabilityDto[];
}) {
  const [tab, setTab] = useState(0);
  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 2 }}>
        Suggestions
      </Typography>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3 }}
        aria-label="Suggestions sections"
      >
        <Tab label="Pending" />
        <Tab label="History" />
        <Tab label="Reliability" />
      </Tabs>
      {tab === 0 && <PendingQueue pending={pending} />}
      {tab === 1 && <HistoryTable history={history} />}
      {tab === 2 && <ReliabilityView reliability={reliability} />}
    </Box>
  );
}

function statusColor(status: string): "warning" | "primary" | "default" {
  if (status === "pending" || status === "insufficient_evidence")
    return "warning";
  if (status === "accepted") return "primary";
  return "default";
}

function PendingQueue({ pending }: { pending: SuggestionListItem[] }) {
  if (pending.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h2" sx={{ mb: 1 }}>
          Nothing pending.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          ESPN inactives produced no material changes awaiting review.
        </Typography>
      </Paper>
    );
  }
  return (
    <Stack spacing={2}>
      {pending.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} />
      ))}
    </Stack>
  );
}

function SuggestionCard({ suggestion: s }: { suggestion: SuggestionListItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = s.status === "insufficient_evidence";

  async function act(action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/suggestions/${s.id}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(
          "Couldn't apply — try again. The base projection stays active.",
        );
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't apply — try again. The base projection stays active.");
      setBusy(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: "warning.main" }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Chip
          label={held ? "Held" : "Pending"}
          color="warning"
          variant="outlined"
          size="small"
        />
        <Typography variant="label">
          {s.targetPlayerName} · {statLabel(s.statType)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {s.materialThresholdPp != null && (
          <Typography variant="caption" color="text.secondary" sx={mono}>
            material · {s.materialThresholdPp.toFixed(1)} pp
          </Typography>
        )}
      </Stack>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {s.reasonText}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      {!held && (
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => act("accept")}
          >
            Accept
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            disabled={busy}
            onClick={() => act("decline")}
          >
            Decline
          </Button>
        </Stack>
      )}
    </Paper>
  );
}

function HistoryTable({ history }: { history: SuggestionListItem[] }) {
  if (history.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No suggestions yet this season.
        </Typography>
      </Paper>
    );
  }
  return (
    <Paper variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>player</TableCell>
            <TableCell>claim</TableCell>
            <TableCell>source</TableCell>
            <TableCell>you</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {history.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                {s.targetPlayerName} · {statLabel(s.statType)}
              </TableCell>
              <TableCell>
                {s.subjectPlayerName} {s.claimValue}
              </TableCell>
              <TableCell>{s.source}</TableCell>
              <TableCell>
                <Chip
                  label={s.status}
                  size="small"
                  color={statusColor(s.status)}
                  variant="outlined"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

export function ReliabilityView({
  reliability,
}: {
  reliability: SourceReliabilityDto[];
}) {
  if (reliability.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No source has produced a gradable claim yet.
        </Typography>
      </Paper>
    );
  }
  return (
    <Stack spacing={3}>
      {reliability.map((r) => (
        <Box key={r.source}>
          <Typography variant="h2" sx={{ mb: 1 }}>
            {r.source} inactives
          </Typography>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{ alignItems: "stretch" }}
          >
            <ReliabilityTile
              title="Source accuracy"
              caption="was the claim correct?"
              rate={r.sourceAccuracy}
              unit="reports"
            />
            <ReliabilityTile
              title="Adjustment accuracy"
              caption="did reacting help?"
              rate={r.adjustmentAccuracy}
              unit="gradable"
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Adjustment breakdown: improved {r.adjustmentBreakdown.improved} ·
            hurt {r.adjustmentBreakdown.hurt} · neutral{" "}
            {r.adjustmentBreakdown.neutral}
          </Typography>
          <Alert severity="info" sx={{ mt: 1 }}>
            Two different measures. A correct report can still lead to a worse
            projection if the redistribution was wrong — they are never
            combined.
          </Alert>
        </Box>
      ))}
    </Stack>
  );
}

export function ReliabilityTile({
  title,
  caption,
  rate,
  unit,
}: {
  title: string;
  caption: string;
  rate: Rate;
  unit: string;
}) {
  const enough = rate.rate !== null;
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 0 }}>
      <Typography variant="label">{title}</Typography>
      <Typography
        variant="caption"
        color="text.muted"
        sx={{ display: "block" }}
      >
        {caption}
      </Typography>
      {enough ? (
        <Typography
          variant="numericLg"
          component="div"
          color="primary"
          sx={mono}
        >
          {(rate.rate! * 100).toFixed(1)}%
        </Typography>
      ) : (
        <Typography
          variant="body2"
          color="warning.main"
          sx={{ mt: 1, fontWeight: 500 }}
        >
          not enough evidence yet
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={mono}>
        {rate.numerator} of {rate.denominator} {unit}
      </Typography>
    </Paper>
  );
}
