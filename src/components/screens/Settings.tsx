"use client";

import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useColorScheme } from "@mui/material/styles";
import { RoleChip } from "@/components/primitives/RoleChip";
import type { SessionUserDto } from "@/lib/dto/session";

/**
 * Settings.
 *
 * **The only place appearance is selectable in the entire application.** Not
 * the app bar, not the account menu, not a floating control.
 *
 * Selection applies immediately with no save button and no confirmation toast —
 * the interface changing colour is the feedback, and a toast on top of it would
 * be the product editorialising about a display preference.
 */
export function Settings({ user }: { user: SessionUserDto }) {
  const router = useRouter();
  const { mode, setMode } = useColorScheme();

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <Stack spacing={4}>
      <Typography variant="h1">Settings</Typography>

      <Stack spacing={1.5}>
        <Typography variant="h2">Appearance</Typography>
        <Paper sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode ?? "system"}
              onChange={(_, next) => {
                if (next) setMode(next);
              }}
              aria-label="Appearance"
              sx={{ width: { xs: "100%", sm: "auto" } }}
            >
              <ToggleButton
                value="system"
                sx={{ flex: { xs: 1, sm: "none" }, px: 3 }}
              >
                System
              </ToggleButton>
              <ToggleButton
                value="light"
                sx={{ flex: { xs: 1, sm: "none" }, px: 3 }}
              >
                Light
              </ToggleButton>
              <ToggleButton
                value="dark"
                sx={{ flex: { xs: 1, sm: "none" }, px: 3 }}
              >
                Dark
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" sx={{ color: "text.muted" }}>
              System follows your device setting.
            </Typography>
          </Stack>
        </Paper>
      </Stack>

      <Stack spacing={1.5}>
        <Typography variant="h2">Account</Typography>
        <Paper>
          <Stack spacing={1.5} sx={{ p: 2 }}>
            <Field label="Name">
              <Typography variant="body1" noWrap>
                {user.displayName ?? user.email}
              </Typography>
            </Field>
            <Field label="Email">
              <Typography variant="body1" sx={{ overflowWrap: "anywhere" }}>
                {user.email}
              </Typography>
            </Field>
            <Field label="Role">
              <RoleChip role={user.role} />
            </Field>
          </Stack>
          <Divider />
          <Stack sx={{ p: 2, alignItems: "flex-start" }}>
            {/* Not destructive-coloured: signing out loses nothing. */}
            <Button variant="outlined" onClick={signOut}>
              Sign out
            </Button>
          </Stack>
        </Paper>
      </Stack>
    </Stack>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
      <Typography
        variant="label"
        sx={{ color: "text.secondary", minWidth: 64 }}
      >
        {label}
      </Typography>
      {children}
    </Stack>
  );
}
