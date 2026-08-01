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
import type { ContractDetailDto } from "@/lib/dto/slate";

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

      <Section title="Provenance">
        {/* The reserved future home of calibration context (Pitch 6, RD-10). */}
        <NumericText size="sm" muted>
          {detail.projectionComputedAt
            ? `computed ${formatEt(detail.projectionComputedAt)} ET · ` +
              `cutoff ${detail.informationCutoff ? formatEt(detail.informationCutoff) : "—"} ET · ` +
              `model ${detail.modelVersion ?? "—"}`
            : "No projection to attribute."}
        </NumericText>
      </Section>

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
