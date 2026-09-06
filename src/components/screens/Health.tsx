import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { HealthStateChip } from "@/components/primitives/HealthStateChip";
import { NumericText } from "@/components/primitives/NumericText";
import { StatusChip } from "@/components/primitives/StatusChip";
import type {
  HealthDto,
  HealthGameDetailDto,
  HealthSignalDto,
  HealthSourceDetailDto,
} from "@/lib/dto/health";

/**
 * System health.
 *
 * Makes the freshness of Sightline's scheduled systems visible inside the
 * product rather than in a logs tab: three per-category signals, each moved
 * only by completed successful runs, with per-source and per-game detail when
 * — and only when — a cycle was not fully green.
 *
 * The surface reports; it does not operate. No mutations, no retry buttons,
 * no polling, no countdowns, no links to CI, no log excerpts — recovery is a
 * command-line concern, and every value on this page was computed server-side
 * at request time (RD-28: no client clock math).
 */
export function Health({ health }: { health: HealthDto }) {
  const { signals, offseason } = health;

  return (
    <Stack spacing={3}>
      <Typography variant="h1">System health</Typography>

      {offseason ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {offseason.dormantCopy}
        </Typography>
      ) : null}

      <Paper>
        <List disablePadding>
          {signals.map((signal, index) => (
            <SignalBlock
              key={signal.key}
              signal={signal}
              divider={index < signals.length - 1}
            />
          ))}
        </List>
      </Paper>

      {offseason ? (
        <OffseasonReadiness keepalive={offseason.keepalive} />
      ) : null}
    </Stack>
  );
}

function SignalBlock({
  signal,
  divider,
}: {
  signal: HealthSignalDto;
  divider: boolean;
}) {
  const running = signal.state === "running";
  // The attempt row earns its place only when it says something the success
  // row does not: an in-flight attempt, or a latest attempt that is not the
  // latest success.
  const showAttempt =
    !running &&
    signal.lastAttemptAt !== null &&
    signal.lastAttemptAt !== signal.lastSuccessAt;

  return (
    <ListItem
      divider={divider}
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
      {running && signal.lastAttemptAt ? (
        <Row
          label="Current attempt"
          value={`started ${signal.lastAttemptAt}`}
        />
      ) : null}
      {showAttempt ? (
        <Row
          label="Last attempt"
          value={`${signal.lastAttemptAt} · ${signal.lastAttemptOutcome}`}
        />
      ) : null}

      {signal.sources ? <SourceDetail sources={signal.sources} /> : null}
      {signal.games ? <GameCompleteness games={signal.games} /> : null}
      {signal.awaitingGrades ? (
        <AwaitingGrades count={signal.awaitingGrades} state={signal.state} />
      ) : null}
    </ListItem>
  );
}

/**
 * The grading signal's sub-line: completed games not yet fully graded. Zero
 * renders nothing — absence is the healthy state, per the surface's
 * convention. Non-zero is neutral (a backlog the nightly cycle will clear);
 * it turns amber only when the signal itself says the cycle is late or
 * failed, because only then is the backlog evidence of a problem.
 */
function AwaitingGrades({
  count,
  state,
}: {
  count: number;
  state: HealthSignalDto["state"];
}) {
  const caution = state === "late" || state === "failed";
  return (
    <Stack
      direction="row"
      spacing={0.75}
      sx={{ alignItems: "baseline", mt: 0.5 }}
    >
      <NumericText
        size="sm"
        sx={caution ? { color: "warning.main" } : undefined}
      >
        {count}
      </NumericText>
      <Typography
        variant="caption"
        sx={{ color: caution ? "warning.main" : "text.secondary" }}
      >
        completed {count === 1 ? "game" : "games"} awaiting grades
      </Typography>
    </Stack>
  );
}

/**
 * Per-source detail of the latest ingest cycle. Present only when a source is
 * non-ok; a failed required source has already made the parent signal
 * `failed`, while a degraded optional source alone leaves it green with this
 * block as the honest footnote (RD-P7).
 */
function SourceDetail({ sources }: { sources: HealthSourceDetailDto[] }) {
  return (
    <DetailBlock title="sources — latest cycle">
      {sources.map((source) => (
        <Stack
          key={source.name}
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "baseline", justifyContent: "space-between" }}
        >
          <Typography variant="body2">{source.name}</Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
            <Typography
              variant="body2"
              sx={{
                color:
                  source.state === "ok" ? "text.secondary" : "warning.main",
              }}
            >
              {source.state}
            </Typography>
            <NumericText size="sm" muted={!source.finishedAt}>
              {source.finishedAt ?? "—"}
            </NumericText>
            <Typography variant="caption" sx={{ color: "text.muted" }}>
              {source.required ? "required" : "optional"}
            </Typography>
          </Stack>
        </Stack>
      ))}
    </DetailBlock>
  );
}

/**
 * Per-game completeness of the latest recompute cycle. Names games, never
 * players — per-contract currency lives on the slate (RD-P6).
 */
function GameCompleteness({ games }: { games: HealthGameDetailDto }) {
  return (
    <DetailBlock title="games — current slate">
      <Typography variant="body2">
        {games.currentCount} of {games.totalCount} games current
      </Typography>
      {games.lagging.map((game) => (
        <Stack
          key={game.label}
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "baseline", justifyContent: "space-between" }}
        >
          <Typography variant="body2">{game.label}</Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
            <NumericText size="sm">{game.kickoffAt}</NumericText>
            <Typography variant="caption" sx={{ color: "warning.main" }}>
              {game.reason}
            </Typography>
          </Stack>
        </Stack>
      ))}
    </DetailBlock>
  );
}

/**
 * Offseason readiness: the keepalive's last action and its next-required-by
 * date. Amber on exactly one condition — the required date has passed without
 * action (RD-Q11). Old job timestamps elsewhere on the offseason layout stay
 * neutral; they are correct, not late.
 */
function OffseasonReadiness({
  keepalive,
}: {
  keepalive: NonNullable<HealthDto["offseason"]>["keepalive"];
}) {
  return (
    <Paper>
      <Box sx={{ py: 2.5, px: 2 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <Typography variant="body1">Offseason readiness</Typography>
          {keepalive.overdue ? (
            <StatusChip label="overdue" tone="caution" filled icon />
          ) : null}
        </Stack>

        <Row
          label="Keepalive last acted"
          value={keepalive.lastActedAt}
          age={keepalive.lastActedAge}
        />
        <Row label="Next required by" value={keepalive.nextRequiredBy} />

        {keepalive.overdue ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            keepalive overdue — scheduled workflows may be disabled before the
            season resumes.
          </Alert>
        ) : null}
      </Box>
    </Paper>
  );
}

function DetailBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        mt: 1.5,
        p: 1.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
      }}
    >
      <Typography
        variant="label"
        sx={{ color: "text.secondary", display: "block", mb: 0.75 }}
      >
        {title}
      </Typography>
      <Stack spacing={0.5}>{children}</Stack>
    </Box>
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
