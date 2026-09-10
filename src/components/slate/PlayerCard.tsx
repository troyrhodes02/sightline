"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { NumericText } from "@/components/primitives/NumericText";
import { StatusChip } from "@/components/primitives/StatusChip";
import type { PlayerCardDto, PropDto } from "@/lib/dto/slate";
import type { StatType } from "../../../generated/prisma/enums";
import { FreshnessLabel } from "./FreshnessLabel";
import { STAT_LABELS, probabilityGlyph, propTitle } from "./prop-display";
import { ThresholdTable } from "./ThresholdTable";
import {
  ConfidenceValue,
  DispositionChip,
  EdgeValue,
  InsufficientEvidenceChip,
  PriceValue,
  ProbabilityValue,
} from "./values";

/**
 * One player in one game as a single unit (Screen 2). Collapsed shows only the
 * player's best opportunity; expanded steps through stat types and thresholds
 * from the props ALREADY delivered — no refetch, no model run, NO distribution
 * chart (progressive disclosure keeps those in detail).
 *
 * Collapsed height is identical across recommended / below-threshold /
 * no-projection variants: the recommendation marker is a left-edge accent bar
 * (transparent when absent, so the box does not resize) and the best line
 * always occupies one line at `sm`+ / two at `xs`. De-emphasis is text colour,
 * never removal.
 *
 * Adjustment context: an accepted note shows for both roles; a pending
 * suggestion shows the admin an inline accept/decline band posting to the
 * EXISTING Pitch 9 route. A viewer NEVER sees the action band — the role gate
 * is explicit here and the payload is already decision-free for viewers.
 */
export function PlayerCard({
  card,
  isAdmin = false,
  defaultExpanded = false,
}: {
  card: PlayerCardDto;
  isAdmin?: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Which stat type is active in the expanded view. Defaults to the stat of the
  // best opportunity, else the first available.
  const bestStatType = statTypeForProp(card, card.bestOpportunity);
  const [statType, setStatType] = useState<StatType>(
    bestStatType ?? card.statTypes[0] ?? ("receiving_yards" as StatType),
  );

  // The selected prop within the active stat. Local re-emphasis only.
  const [selectedKey, setSelectedKey] = useState<string>(() =>
    card.bestOpportunity
      ? `${card.bestOpportunity.direction}:${card.bestOpportunity.threshold}`
      : "",
  );

  const statProps = propsForStat(card, statType);

  const best = card.bestOpportunity;
  const recommended = best?.isRecommended === true;

  return (
    <Box
      data-player-card
      sx={{
        borderLeft: "3px solid",
        borderLeftColor: recommended ? "primary.main" : "transparent",
        borderBottom: "1px solid",
        borderBottomColor: "divider",
        "&:last-of-type": { borderBottom: "none" },
      }}
    >
      <Box
        component="button"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prior) => !prior)}
        sx={{
          display: "block",
          width: "100%",
          textAlign: "left",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          font: "inherit",
          color: "inherit",
          px: 2,
          py: 1.25,
          "&:hover": { bgcolor: "action.hover" },
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: -2,
          },
        }}
      >
        <CardHeader card={card} recommended={recommended} isAdmin={isAdmin} />
        <BestLine card={card} expanded={expanded} />
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: 2, pb: 2 }}>
          {card.statTypes.length > 1 ? (
            <Tabs
              value={statType}
              onChange={(_event, next: StatType) => {
                setStatType(next);
                // Re-anchor selection to the new stat's first threshold.
                const first = propsForStat(card, next)[0];
                setSelectedKey(
                  first ? `${first.direction}:${first.threshold}` : "",
                );
              }}
              variant="scrollable"
              scrollButtons="auto"
              aria-label="Stat type"
              sx={{ minHeight: 40, mb: 1, "& .MuiTab-root": { minHeight: 40 } }}
            >
              {card.statTypes.map((stat) => (
                <Tab key={stat} value={stat} label={STAT_LABELS[stat]} />
              ))}
            </Tabs>
          ) : null}

          {statProps.length > 0 ? (
            <ThresholdTable
              props={statProps}
              selectedKey={selectedKey}
              onSelect={(prop) =>
                setSelectedKey(`${prop.direction}:${prop.threshold}`)
              }
            />
          ) : (
            <Typography variant="body2" sx={{ color: "text.secondary", py: 1 }}>
              No thresholds listed for {STAT_LABELS[statType]}.
            </Typography>
          )}

          <AdjustmentContext card={card} isAdmin={isAdmin} />

          <OpenDetailLink statProps={statProps} selectedKey={selectedKey} />
        </Box>
      </Collapse>
    </Box>
  );
}

function CardHeader({
  card,
  recommended,
  isAdmin,
}: {
  card: PlayerCardDto;
  recommended: boolean;
  isAdmin: boolean;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: "center", justifyContent: "space-between" }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 0, sm: 1 }}
        sx={{ alignItems: { sm: "baseline" }, minWidth: 0 }}
      >
        <Typography variant="body1" sx={{ color: "text.primary" }} noWrap>
          {card.playerName}
        </Typography>
        <Typography
          variant="numericSm"
          sx={{ color: "text.secondary" }}
          suppressHydrationWarning
        >
          {card.teamAbbreviation || "—"} vs {card.opponentAbbreviation || "—"}
        </Typography>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexShrink: 0 }}
      >
        {isAdmin && card.currentDisposition ? (
          <DispositionChip disposition={card.currentDisposition} />
        ) : null}
        {card.adjustment.kind === "accepted" ? (
          <StatusChip label="adjusted" tone="accent" />
        ) : null}
        {card.adjustment.kind === "pending" ? (
          <StatusChip label="new information" tone="caution" icon />
        ) : null}
        {recommended ? <StatusChip label="recommended" tone="accent" /> : null}
        <FreshnessLabel freshness={card.freshness} />
      </Stack>
    </Stack>
  );
}

/**
 * The single best-opportunity line, or the designed absence when there is no
 * projection. One line at `sm`+, wraps to a second at `xs`. Height is stable
 * across variants because every variant renders exactly this row.
 */
function BestLine({
  card,
  expanded,
}: {
  card: PlayerCardDto;
  expanded: boolean;
}) {
  const best = card.bestOpportunity;
  const bestStat = statTypeForProp(card, best);

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "baseline",
        justifyContent: "space-between",
        mt: 0.5,
        flexWrap: { xs: "wrap", sm: "nowrap" },
      }}
    >
      <Typography
        variant="body2"
        sx={{ color: best?.isRecommended ? "text.primary" : "text.secondary" }}
      >
        {card.projectionState === "insufficient_evidence" ? (
          "Best: "
        ) : best && bestStat ? (
          <>Best: {propTitle(bestStat, best)}</>
        ) : (
          "No listed opportunity"
        )}
      </Typography>

      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "baseline", flexShrink: 0 }}
      >
        {card.projectionState === "insufficient_evidence" ? (
          <InsufficientEvidenceChip />
        ) : best ? (
          <>
            <NumericText size="sm" muted sx={{ color: "text.muted" }}>
              {probabilityGlyph(best.direction)}
            </NumericText>
            <ProbabilityValue value={best.modelProbability} size="sm" />
            <ConfidenceValue confidence={best.confidence} size="sm" />
            <PriceValue cents={best.askCents} size="sm" />
            <EdgeValue points={best.edgePoints} size="sm" />
          </>
        ) : null}
        <Stack
          direction="row"
          spacing={0.25}
          sx={{ alignItems: "center", color: "text.secondary" }}
        >
          <NumericText size="sm" muted>
            {card.props.length}
          </NumericText>
          <ExpandMoreIcon
            sx={{
              fontSize: 16,
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 120ms",
            }}
            aria-hidden
          />
        </Stack>
      </Stack>
    </Stack>
  );
}

function AdjustmentContext({
  card,
  isAdmin,
}: {
  card: PlayerCardDto;
  isAdmin: boolean;
}) {
  const { adjustment } = card;
  if (adjustment.kind === null) return null;

  // Accepted note — shown to BOTH roles as context (the shadow is active).
  if (adjustment.kind === "accepted") {
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 1.5, alignItems: "baseline" }}
      >
        <StatusChip label="adjusted" tone="accent" />
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {adjustment.note ?? "Projection adjusted."}
        </Typography>
      </Stack>
    );
  }

  // Pending: viewer sees only the status word (rendered in the header chip);
  // the action band is admin-only.
  if (!isAdmin) {
    return (
      <Typography variant="body2" sx={{ mt: 1.5, color: "warning.main" }}>
        {adjustment.note ?? "New information is pending review."}
      </Typography>
    );
  }

  return (
    <SuggestionActionBand
      suggestionId={adjustment.suggestionId}
      note={adjustment.note}
    />
  );
}

/**
 * The admin-only inline accept/decline band (design doc Screen 2). Posts to the
 * EXISTING Pitch 9 route — no second suggestion mechanism — and on success
 * refreshes the server tree so the projection and the note update in place,
 * with the specified notifications.
 */
function SuggestionActionBand({
  suggestionId,
  note,
}: {
  suggestionId: string | null;
  note: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    severity: "success" | "info";
  } | null>(null);

  async function act(action: "accept" | "decline") {
    if (!suggestionId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/suggestions/${suggestionId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(
          "Couldn't apply — try again. The base projection stays active.",
        );
        setBusy(false);
        return;
      }
      setConfirmation(
        action === "accept"
          ? { message: "Projection updated", severity: "success" }
          : { message: "Suggestion declined", severity: "info" },
      );
      router.refresh();
    } catch {
      setError("Couldn't apply — try again. The base projection stays active.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        mt: 1.5,
        p: 1.5,
        border: "1px solid",
        borderColor: "warning.main",
        borderRadius: 1,
        bgcolor: "warning.soft",
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
        <StatusChip label="new information" tone="caution" icon />
        <Typography variant="body2" sx={{ color: "text.primary" }}>
          {note ?? "New information is pending review."}
        </Typography>
      </Stack>
      {error ? (
        <Alert severity="error" role="alert" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button
          variant="contained"
          size="small"
          disabled={busy}
          onClick={() => act("accept")}
        >
          Review &amp; accept
        </Button>
        <Button
          variant="outlined"
          size="small"
          color="inherit"
          disabled={busy}
          onClick={() => act("decline")}
          sx={{ color: "text.secondary", borderColor: "border.strong" }}
        >
          Decline
        </Button>
      </Stack>
      <Snackbar
        open={confirmation !== null}
        autoHideDuration={3000}
        onClose={() => setConfirmation(null)}
      >
        <Alert
          severity={confirmation?.severity ?? "success"}
          variant="outlined"
        >
          {confirmation?.message ?? ""}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function OpenDetailLink({
  statProps,
  selectedKey,
}: {
  statProps: PropDto[];
  selectedKey: string;
}) {
  const selected =
    statProps.find(
      (prop) => `${prop.direction}:${prop.threshold}` === selectedKey,
    ) ?? statProps[0];
  const contractId = selected?.contractId ?? null;
  if (!contractId) return null;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Button
        variant="text"
        size="small"
        href={`/slate/${contractId}`}
        component="a"
      >
        Open detail →
      </Button>
    </Box>
  );
}

// --- prop grouping helpers (client-side over already-loaded data) -----------

/**
 * The props for one stat type, filtered client-side from the flat list the
 * grouped read already delivered (each `PropDto` carries its `statType`). No
 * refetch, no model run — switching the stat tab is pure re-emphasis.
 */
function propsForStat(card: PlayerCardDto, statType: StatType): PropDto[] {
  return card.props.filter((prop) => prop.statType === statType);
}

/** The stat type of a prop, straight from the prop itself. */
function statTypeForProp(
  _card: PlayerCardDto,
  prop: PropDto | null,
): StatType | null {
  return prop?.statType ?? null;
}
