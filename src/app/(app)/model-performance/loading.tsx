import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

/**
 * Model Performance loading state: skeleton blocks at final heights — the level
 * tabs, the two summary cards, the stat-leader table, and the three scorecards.
 * Never a spinner: this surface reads stored aggregates and the paper ledger,
 * and must not look like it is waiting on grading, a backtest, or a paper cycle.
 */
export default function ModelPerformanceLoading() {
  return (
    <Stack spacing={2}>
      <Typography variant="h1">Model Performance</Typography>
      <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 2,
        }}
      >
        <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1 }} />
      </Box>
      <Skeleton variant="rectangular" height={240} sx={{ borderRadius: 1 }} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 1 }} />
      </Box>
    </Stack>
  );
}
