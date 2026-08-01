import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";

/** Skeletons match the final 52px row height, so the layout does not shift. */
export default function UsersLoading() {
  return (
    <Stack spacing={3}>
      <Skeleton variant="rectangular" width={96} height={28} />
      <Paper>
        <Stack spacing={1} sx={{ p: 2 }}>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} variant="rectangular" height={52} />
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
