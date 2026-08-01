import Box from "@mui/material/Box";
import { NotFound } from "@/components/screens/Terminal";

export const metadata = { title: "Not found · Sightline" };

export default function NotFoundPage() {
  return (
    <Box
      sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 2 }}
    >
      <Box sx={{ width: "100%", maxWidth: 480 }}>
        <NotFound />
      </Box>
    </Box>
  );
}
