import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * Slate loading state: skeleton rows at the exact final row height so the
 * layout does not shift, and never a spinner — the slate reads stored data
 * and must not look like it is waiting on a model run.
 */
export default function SlateLoading() {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Slate</Typography>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={1}>
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton
              key={index}
              variant="rectangular"
              height={64}
              sx={{ borderRadius: 1 }}
            />
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
