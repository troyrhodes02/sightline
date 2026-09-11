// A client component only because it hands `component={Link}` to MUI's Link (a
// function prop that cannot cross the RSC boundary). It holds no state and no
// handler — the single affordance is a navigation link, never a mutation.
"use client";

import Link from "next/link";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ModelRecommendationDto } from "@/lib/dto/model-eval";

/**
 * The plain-language recommendation (D12).
 *
 * **Decision support, structurally read-only.** The card renders prose from the
 * recommendation DTO and offers exactly one affordance: a `Review selection →`
 * link to Paper Bot → Settings, where the human makes the one confirmed
 * selection that changes production config. There is no "apply", no "use this
 * model", no toggle, and no form here — this component cannot, by its own
 * surface, mutate `ModelSelection` or any config. The standing separation
 * sentence (D17) renders beneath the prose so a financial result is never
 * mistaken for the model-quality verdict.
 */
export function RecommendationCard({
  recommendation,
}: {
  recommendation: ModelRecommendationDto;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          Sightline recommends
        </Typography>
        <Typography variant="body2">{recommendation.text}</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Paper results measure whether a model would have made money; model
          quality is judged on calibration, not P&amp;L. They are reported
          apart.
        </Typography>
        <MuiLink
          component={Link}
          href="/autonomy/settings"
          variant="body2"
          sx={{ alignSelf: "flex-start" }}
        >
          Review selection →
        </MuiLink>
      </Stack>
    </Paper>
  );
}
