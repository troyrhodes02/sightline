import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * Overrides loading state: skeleton tiles and table rows at final heights —
 * never a spinner; this page reads stored snapshots and settlements only.
 */
export default function OverridesLoading() {
  return (
    <Stack spacing={2}>
      <Typography variant="h1">Overrides</Typography>
      <Skeleton variant="rectangular" height={56} sx={{ borderRadius: 1 }} />
      <Skeleton variant="text" width={480} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1 }} />
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 2,
        }}
      >
        <Skeleton variant="rectangular" height={180} sx={{ borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={180} sx={{ borderRadius: 1 }} />
      </Box>
      <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 1 }} />
    </Stack>
  );
}
