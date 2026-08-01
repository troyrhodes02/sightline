import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";

/** Skeletons match the final 80px signal-row height, so nothing shifts. */
export default function HealthLoading() {
  return (
    <Stack spacing={3}>
      <Skeleton variant="rectangular" width={150} height={30} />
      <Paper>
        <Stack spacing={1} sx={{ p: 2 }}>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} variant="rectangular" height={80} />
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
