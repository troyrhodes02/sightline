import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { SlateKeyNav } from "@/components/slate/SlateKeyNav";
import {
  RefreshPricesButton,
  SlatePoller,
} from "@/components/slate/SlatePoller";
import { SlateRow, UnresolvedRow } from "@/components/slate/SlateRow";
import { formatEt, formatEtDate } from "@/components/slate/values";
import type { SlateDto } from "@/lib/dto/slate";

/**
 * The slate — the product's front door. Ranked by confidence-adjusted edge
 * against the executable ask; below-threshold rows stay visible and
 * de-emphasised; unresolved contracts are retained in their own section.
 *
 * Renders entirely from the DTO the server read produced. Kalshi being
 * unreachable is a DESIGNED degraded mode with one banner, never an error
 * page, and never per-row noise. An empty slate is the most-seen state of
 * the year and each empty variant is a deliberate answer.
 */
export function Slate({
  slate,
  refreshIntervalSeconds,
}: {
  slate: SlateDto;
  refreshIntervalSeconds: number;
}) {
  const hasGames = slate.gameCount > 0;
  const hasRows = slate.rows.length > 0 || slate.unresolved.length > 0;
  const nothingRecommended =
    slate.rows.length > 0 && slate.rows.every((row) => !row.isRecommended);

  return (
    <Stack spacing={3}>
      <SlatePoller intervalSeconds={refreshIntervalSeconds} />

      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "flex-end", justifyContent: "space-between" }}
      >
        <Stack spacing={0.5}>
          <Typography variant="h1">Slate</Typography>
          {hasGames ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {slate.slateDate ? `${formatEtDate(slate.slateDate)} · ` : ""}
              {slate.gameCount} {slate.gameCount === 1 ? "game" : "games"}
            </Typography>
          ) : null}
        </Stack>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", flexShrink: 0 }}
        >
          {slate.lastSync?.finishedAt ? (
            <NumericText
              size="sm"
              muted
              sx={{ display: { xs: "none", sm: "block" } }}
            >
              prices as of {formatEt(slate.lastSync.finishedAt)}
            </NumericText>
          ) : null}
          <RefreshPricesButton />
        </Stack>
      </Stack>

      {slate.degraded ? (
        <Alert severity="warning">
          Kalshi is unreachable. Prices, edges, and recommendations show
          last-observed state
          {slate.lastSync?.finishedAt
            ? ` as of ${formatEt(slate.lastSync.finishedAt)}`
            : ""}
          .
        </Alert>
      ) : slate.lastSync?.status === "partial" ? (
        <Alert severity="warning">
          Some markets could not be refreshed; showing last observed prices
          where current ones are unavailable.
        </Alert>
      ) : null}

      {!hasGames ? (
        <Paper>
          <EmptyState
            title="No upcoming games."
            detail={
              slate.nextKickoffAt
                ? `Next kickoff: ${formatEtDate(slate.nextKickoffAt)}, ${formatEt(slate.nextKickoffAt)} ET.`
                : "The season schedule has not been published."
            }
          />
        </Paper>
      ) : !hasRows ? (
        <Paper>
          <EmptyState
            title="No Kalshi player-prop contracts are listed yet for these games."
            detail={
              slate.lastSync?.finishedAt
                ? `Last checked ${formatEt(slate.lastSync.finishedAt)} ET.`
                : "Kalshi has not been checked yet — refresh prices to run the first sync."
            }
          />
        </Paper>
      ) : (
        <>
          {nothingRecommended ? (
            // A legitimate answer, deliberately quiet — never warning-styled.
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              No contracts meet the recommendation threshold today.
            </Typography>
          ) : null}

          <SlateKeyNav>
            {slate.rows.length > 0 ? (
              <Paper sx={{ overflow: "hidden" }}>
                {slate.rows.map((row) => (
                  <SlateRow key={row.contractId} row={row} />
                ))}
              </Paper>
            ) : null}

            {slate.unresolved.length > 0 ? (
              <Stack spacing={1} sx={{ mt: slate.rows.length > 0 ? 3 : 0 }}>
                <Typography variant="h2">
                  Unresolved contracts ({slate.unresolved.length})
                </Typography>
                {slate.rows.length === 0 ? (
                  <Alert severity="warning">
                    No listed contract could be matched to a player yet.
                  </Alert>
                ) : null}
                <Paper sx={{ overflow: "hidden" }}>
                  {slate.unresolved.map((row) => (
                    <UnresolvedRow key={row.contractId} row={row} />
                  ))}
                </Paper>
              </Stack>
            ) : null}
          </SlateKeyNav>
        </>
      )}
    </Stack>
  );
}
