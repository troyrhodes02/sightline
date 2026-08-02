import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

/**
 * Accuracy loading state: skeleton panels at final heights — scope bar,
 * calibration, and the two side panels. Never a spinner: this page reads
 * stored aggregates only and must not look like it is waiting on grading,
 * a backtest, or recomputation.
 */
export default function AccuracyLoading() {
  return (
    <Stack spacing={2}>
      <Typography variant="h1">Accuracy</Typography>
      <Skeleton variant="rectangular" height={56} sx={{ borderRadius: 1 }} />
      <Skeleton variant="text" width={320} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "3fr 2fr" },
          gap: 2,
        }}
      >
        <Skeleton variant="rectangular" height={420} sx={{ borderRadius: 1 }} />
        <Stack spacing={2}>
          <Skeleton
            variant="rectangular"
            height={180}
            sx={{ borderRadius: 1 }}
          />
          <Skeleton
            variant="rectangular"
            height={180}
            sx={{ borderRadius: 1 }}
          />
        </Stack>
      </Box>
    </Stack>
  );
}
