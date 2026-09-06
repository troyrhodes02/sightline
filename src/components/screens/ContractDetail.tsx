// A client component because the back link passes `component={Link}` to MUI
// (a function prop that cannot cross the RSC serialization boundary — same
// reasoning as EmptyState). Everything it receives is a serializable DTO or a
// ReactNode slot.
"use client";

import Divider from "@mui/material/Divider";
import Link from "next/link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { NumericText } from "@/components/primitives/NumericText";
import { StatusChip } from "@/components/primitives/StatusChip";
import { DistributionSummary } from "@/components/slate/DistributionSummary";
import {
  ResolveControl,
  type ResolveCandidate,
} from "@/components/slate/ResolveControl";
import {
  ConfidenceValue,
  DispositionChip,
  EdgeValue,
  formatEt,
  PriceValue,
  ProbabilityValue,
} from "@/components/slate/values";
import type { ContractDetailDto, OutcomeBlockDto } from "@/lib/dto/slate";

const STAT_SENTENCE: Record<ContractDetailDto["statType"], string> = {
  passing_yards: "passing yards",
  rushing_yards: "rushing yards",
  receiving_yards: "receiving yards",
  receptions: "receptions",
  rushing_tds: "rushing touchdowns",
  receiving_tds: "receiving touchdowns",
};

/**
 * Contract detail: the full reasoning behind one comparison. Sections in the
 * design doc's order — comparison headline, projection with the distribution
 * summary, verbatim drivers, both books with the mid as labelled context,
 * provenance (the reserved future home of calibration context, RD-10) — and
 * the unresolved variants.
 *
 * The decision section arrives with the decision-log ticket; `decisionSlot`
 * is where it mounts, admin only.
 */
export function ContractDetail({
  detail,
  isAdmin,
  isUnresolved,
  resolveCandidates,
  decisionSlot,
}: {
  detail: ContractDetailDto;
  isAdmin: boolean;
  isUnresolved: boolean;
  resolveCandidates?: ResolveCandidate[];
  decisionSlot?: React.ReactNode;
}) {
  if (isUnresolved) {
    return (
      <UnresolvedDetail
        detail={detail}
        isAdmin={isAdmin}
        resolveCandidates={resolveCandidates ?? []}
      />
    );
  }

  const statSentence = STAT_SENTENCE[detail.statType];
  const hasProjection = detail.modelProbability !== null;
  const hasPrice = detail.yesAskCents !== null || detail.noAskCents !== null;

  return (
    <Stack spacing={3}>
      <BackLink />
      <Stack spacing={0.5}>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Typography variant="h1">{detail.playerName}</Typography>
          {detail.isRecommended ? (
            <StatusChip
              label={`recommended · ${detail.side ?? ""}`}
              tone="accent"
            />
          ) : null}
          {!hasProjection ? (
            <StatusChip label="no projection" tone="caution" />
          ) : null}
          {detail.staleness?.isStale ? (
            <StatusChip label="stale" tone="caution" icon />
          ) : null}
          {detail.staleness?.predatesInactives ? (
            <StatusChip label="predates inactives" tone="neutral" />
          ) : null}
          {detail.status !== "active" ? (
            <StatusChip label={detail.status} tone="neutral" />
          ) : null}
        </Stack>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {detail.gameLabel ?? "—"} ·{" "}
          {detail.kickoffAt ? `${formatEt(detail.kickoffAt)} ET · ` : ""}
          {statSentence} ≥ {detail.threshold}
        </Typography>
      </Stack>

      <Paper sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={4} sx={{ flexWrap: "wrap", rowGap: 2 }}>
          <HeadlineCell label={`model P(≥ ${detail.threshold})`}>
            <ProbabilityValue value={detail.modelProbability} size="lg" />
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ alignItems: "baseline" }}
            >
              <Typography
                variant="caption"
                component="span"
                sx={{ color: "text.muted" }}
              >
                confidence
              </Typography>
              <ConfidenceValue confidence={detail.confidence} size="sm" />
            </Stack>
          </HeadlineCell>
          <HeadlineCell label={`market ask (${detail.side ?? "yes"})`}>
            <PriceValue
              cents={
                detail.side === "no" ? detail.noAskCents : detail.yesAskCents
              }
              size="lg"
            />
            {detail.priceObservedAt ? (
              <NumericText size="sm" muted>
                observed {formatEt(detail.priceObservedAt)}
              </NumericText>
            ) : null}
          </HeadlineCell>
          <HeadlineCell label="edge">
            <EdgeValue points={detail.edgePoints} size="lg" />
            <Typography variant="caption" sx={{ color: "text.muted" }}>
              vs executable ask
            </Typography>
          </HeadlineCell>
        </Stack>
        {!hasProjection ? (
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 2 }}>
            Sightline has no projection for this contract — insufficient
            eligible history.
          </Typography>
        ) : null}
      </Paper>

      {hasProjection ? (
        <Section title="Projection">
          <Stack
            direction="row"
            spacing={3}
            sx={{ flexWrap: "wrap", rowGap: 1, alignItems: "baseline" }}
          >
            <LabelledNumeric label="projected" value={detail.projectedValue} />
            <LabelledNumeric label="median" value={detail.projectedMedian} />
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: "baseline" }}
            >
              <Typography
                variant="body2"
                component="span"
                sx={{ color: "text.secondary" }}
              >
                80% interval
              </Typography>
              <NumericText size="md" sx={{ color: "primary.main" }}>
                {detail.intervalLow} – {detail.intervalHigh}
              </NumericText>
            </Stack>
          </Stack>
          {detail.quantiles ? (
            <DistributionSummary
              quantiles={detail.quantiles}
              threshold={detail.threshold}
              probability={detail.modelProbability}
              unitLabel={statSentence}
            />
          ) : null}
        </Section>
      ) : null}

      {detail.drivers.length > 0 ? (
        <Section title="Drivers">
          <Stack component="ul" spacing={0.75} sx={{ m: 0, pl: 2.5 }}>
            {detail.drivers.map((driver) => (
              <Typography key={driver} component="li" variant="body1">
                {driver}
              </Typography>
            ))}
          </Stack>
        </Section>
      ) : null}

      <Section title="Market">
        {hasPrice ? (
          <>
            <Stack
              direction="row"
              spacing={3}
              sx={{ flexWrap: "wrap", rowGap: 1, alignItems: "baseline" }}
            >
              <LabelledPrice label="yes bid" cents={detail.yesBidCents} />
              <LabelledPrice label="yes ask" cents={detail.yesAskCents} />
              <LabelledPrice label="no bid" cents={detail.noBidCents} />
              <LabelledPrice label="no ask" cents={detail.noAskCents} />
              <LabelledPrice label="mid" cents={detail.midCents} />
            </Stack>
            <NumericText size="sm" muted>
              {detail.priceObservedAt
                ? `observed ${formatEt(detail.priceObservedAt)} ET · ask drives ranking; mid is context`
                : ""}
            </NumericText>
          </>
        ) : (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            No current market.{" "}
            {detail.priceObservedAt
              ? `Last observed ${formatEt(detail.priceObservedAt)} ET.`
              : "Never observed."}
          </Typography>
        )}
      </Section>

      {hasProjection ? (
        <Section title="Currency">
          {/* Promoted from Provenance: what the projection did and did not
              include. Also the reserved future home of calibration context
              (Outcome Scoring & Accuracy Surface, RD-10). */}
          <Stack spacing={0.5}>
            <CurrencyLine
              label="computed"
              value={
                detail.projectionComputedAt
                  ? `${formatEt(detail.projectionComputedAt)} ET${detail.projectionAge ? ` (${detail.projectionAge} ago)` : ""}`
                  : "—"
              }
            />
            <CurrencyLine
              label="information cutoff"
              value={
                detail.informationCutoff
                  ? `${formatEt(detail.informationCutoff)} ET`
                  : "—"
              }
            />
            <CurrencyLine label="model" value={detail.modelVersion ?? "—"} />
          </Stack>
          {detail.staleness?.isStale ? (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              <Typography
                component="span"
                variant="caption"
                sx={{ color: "warning.main" }}
              >
                stale
              </Typography>
              {" — information Sightline can ingest has arrived for this game" +
                " since this projection was computed. A scheduled recompute" +
                " clears this when the cutoff reflects it."}
            </Typography>
          ) : null}
          {detail.staleness?.predatesInactives ? (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              <Typography
                component="span"
                variant="caption"
                sx={{ color: "text.primary" }}
              >
                predates inactives
              </Typography>
              {` — official inactives for this game ${
                detail.staleness.inactivesExpectedAt
                  ? `are expected as of ${formatEt(detail.staleness.inactivesExpectedAt)} ET`
                  : "are expected before kickoff"
              }. Sightline has no inactives source in this version; this` +
                " projection was computed before them."}
            </Typography>
          ) : null}
        </Section>
      ) : null}

      {detail.outcomeBlock ? (
        <Section title="Outcome">
          <OutcomeSection
            block={detail.outcomeBlock}
            threshold={detail.threshold}
            statSentence={statSentence}
          />
        </Section>
      ) : null}

      {decisionSlot ? (
        <Section title="Decision">
          {decisionSlot}
          {detail.currentDisposition ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <DispositionChip disposition={detail.currentDisposition} />
              {detail.decidedAt ? (
                <NumericText size="sm" muted>
                  {formatEt(detail.decidedAt)} ET
                </NumericText>
              ) : null}
            </Stack>
          ) : null}
        </Section>
      ) : null}
    </Stack>
  );
}

const GRADE_STATUS_LABELS: Record<string, string> = {
  missing_official_result: "no official result",
  game_never_completed: "game not completed",
  unsupported_stat_type: "unsupported stat",
};

/**
 * The outcome block — rendered only once the game completed (or cancelled):
 * absence is the pre-outcome state. The official line is neutral text (the
 * world, not either source's claim); the settlement is market mint; each
 * grade line names its truth source; and a disagreement between the two
 * truths is displayed with both values preserved, never reconciled. Absent
 * grades render their taxonomy chip, never a blank. The decision line exists
 * only when the admin payload carries it.
 */
function OutcomeSection({
  block,
  threshold,
  statSentence,
}: {
  block: OutcomeBlockDto;
  threshold: number;
  statSentence: string;
}) {
  return (
    <Stack spacing={1}>
      <OutcomeLine label="official result">
        {block.officialValue === null ? (
          <NumericText size="md" muted>
            —
          </NumericText>
        ) : (
          <Stack spacing={0.25}>
            <NumericText size="md" sx={{ color: "text.primary" }}>
              {block.officialValue} {statSentence} (final)
            </NumericText>
            {block.officialCorrectedAt ? (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                corrected {formatEt(block.officialCorrectedAt)} ET
              </Typography>
            ) : null}
          </Stack>
        )}
      </OutcomeLine>

      <OutcomeLine label="settlement">
        {block.settlement === null ? (
          <StatusChip label="pending" tone="neutral" />
        ) : block.settlement.result === "voided" ? (
          <StatusChip label="voided" tone="neutral" />
        ) : (
          <NumericText size="md" sx={{ color: "market.main" }}>
            {block.settlement.result}
            {block.settlement.settledAt
              ? ` · settled ${formatEt(block.settlement.settledAt)} ET`
              : ""}
          </NumericText>
        )}
      </OutcomeLine>

      <OutcomeLine label="projection grade">
        {block.projectionGrade === null ? (
          <StatusChip label="pending" tone="neutral" />
        ) : block.projectionGrade.status !== "graded" ? (
          <StatusChip
            label={
              GRADE_STATUS_LABELS[block.projectionGrade.status] ??
              block.projectionGrade.status
            }
            tone="neutral"
          />
        ) : (
          <Typography variant="body2" component="span">
            over {threshold}:{" "}
            {block.projectionGrade.hit === null
              ? "—"
              : block.projectionGrade.hit
                ? "hit ✓"
                : "miss ✗"}
            {block.projectionGrade.statedProbability !== null
              ? ` (p ${(block.projectionGrade.statedProbability * 100).toFixed(1)}%)`
              : ""}{" "}
            <Typography
              variant="caption"
              component="span"
              sx={{ color: "text.secondary" }}
            >
              vs official result
            </Typography>
          </Typography>
        )}
      </OutcomeLine>

      <OutcomeLine label="recommendation">
        {block.recommendationGrade === null ? (
          <NumericText size="sm" muted>
            —
          </NumericText>
        ) : block.recommendationGrade === "correct" ||
          block.recommendationGrade === "incorrect" ? (
          <Typography variant="body2" component="span">
            {block.recommendationGrade === "correct"
              ? "correct ✓"
              : "incorrect ✗"}{" "}
            <Typography
              variant="caption"
              component="span"
              sx={{ color: "text.secondary" }}
            >
              by settlement, per the final pre-kickoff snapshot
            </Typography>
          </Typography>
        ) : (
          <StatusChip
            label={
              block.recommendationGrade === "missing_final_snapshot"
                ? "no final snapshot"
                : block.recommendationGrade
            }
            tone="neutral"
          />
        )}
      </OutcomeLine>

      {block.sourcesDisagree ? (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <StatusChip label="sources disagree" tone="caution" icon />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            official {block.officialValue ?? "—"}, market settled{" "}
            {block.settlement?.result ?? "—"} · both retained
          </Typography>
        </Stack>
      ) : null}

      {block.decision ? (
        <OutcomeLine label="decision">
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <DispositionChip
              disposition={
                block.decision.disposition as Parameters<
                  typeof DispositionChip
                >[0]["disposition"]
              }
            />
            <NumericText size="sm" muted>
              {block.decision.outcome.replace("_", " ")}
            </NumericText>
          </Stack>
        </OutcomeLine>
      ) : null}
    </Stack>
  );
}

/** One outcome row: label + value, stacking label-over-value at xs. */
function OutcomeLine({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0.25, sm: 0.75 }}
      sx={{ alignItems: { sm: "baseline" } }}
    >
      <Typography
        variant="body2"
        component="span"
        sx={{ color: "text.secondary", minWidth: { sm: 140 } }}
      >
        {label}
      </Typography>
      {children}
    </Stack>
  );
}

/** The unresolved variant: shared facts for both roles, diagnostics admin-only. */
function UnresolvedDetail({
  detail,
  isAdmin,
  resolveCandidates,
}: {
  detail: ContractDetailDto;
  isAdmin: boolean;
  resolveCandidates: ResolveCandidate[];
}) {
  return (
    <Stack spacing={3}>
      <BackLink />
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography variant="h1">Unresolved contract</Typography>
          <StatusChip label="unresolved" tone="caution" icon />
        </Stack>
        <Typography variant="body1" sx={{ color: "text.secondary" }}>
          “{detail.playerName}”
        </Typography>
      </Stack>

      <Section title="Market">
        {detail.yesAskCents !== null || detail.yesBidCents !== null ? (
          <Stack direction="row" spacing={3} sx={{ alignItems: "baseline" }}>
            <LabelledPrice label="yes bid" cents={detail.yesBidCents} />
            <LabelledPrice label="yes ask" cents={detail.yesAskCents} />
            <NumericText size="sm" muted>
              {detail.priceObservedAt
                ? `observed ${formatEt(detail.priceObservedAt)} ET`
                : ""}
            </NumericText>
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Never observed.
          </Typography>
        )}
      </Section>

      {isAdmin ? (
        <Section title="Why it is unresolved">
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {detail.resolutionNote ??
              "No diagnostic was recorded for this contract."}
          </Typography>
          <ResolveControl
            contractId={detail.contractId}
            kalshiName={detail.kalshiPlayerName ?? detail.playerName}
            candidates={resolveCandidates}
          />
        </Section>
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          This contract has not been matched to a player yet. Projections are
          unavailable for it.
        </Typography>
      )}
    </Stack>
  );
}

function BackLink() {
  return (
    <Typography
      component={Link}
      href="/slate"
      variant="body2"
      sx={{
        color: "text.secondary",
        textDecoration: "none",
        "&:hover": { color: "text.primary" },
        alignSelf: "flex-start",
      }}
    >
      ← Slate
    </Typography>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          {title}
        </Typography>
        <Divider />
        {children}
      </Stack>
    </Paper>
  );
}

function HeadlineCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="label" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      {children}
    </Stack>
  );
}

/** One Currency row: label + monospace value, stacking label-over-value at xs. */
function CurrencyLine({ label, value }: { label: string; value: string }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0, sm: 0.75 }}
      sx={{ alignItems: { sm: "baseline" } }}
    >
      <Typography
        variant="body2"
        component="span"
        sx={{ color: "text.secondary" }}
      >
        {label}
      </Typography>
      <NumericText size="sm" muted>
        {value}
      </NumericText>
    </Stack>
  );
}

function LabelledNumeric({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
      <Typography
        variant="body2"
        component="span"
        sx={{ color: "text.secondary" }}
      >
        {label}
      </Typography>
      <NumericText size="md" sx={{ color: "primary.main" }}>
        {value ?? "—"}
      </NumericText>
    </Stack>
  );
}

function LabelledPrice({
  label,
  cents,
}: {
  label: string;
  cents: number | null;
}) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
      <Typography
        variant="body2"
        component="span"
        sx={{ color: "text.secondary" }}
      >
        {label}
      </Typography>
      <PriceValue cents={cents} size="md" />
    </Stack>
  );
}
