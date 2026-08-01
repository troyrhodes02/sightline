"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { RoleChip } from "@/components/primitives/RoleChip";
import type { SessionUserDto } from "@/lib/dto/session";

function initials(user: SessionUserDto): string {
  const source = user.displayName ?? user.email;
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Account controls.
 *
 * **Contains no appearance control.** Appearance lives in Settings and nowhere
 * else — not here, not in the app bar, not behind a floating sun icon.
 */
export function AccountMenu({ user }: { user: SessionUserDto }) {
  const router = useRouter();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  async function signOut() {
    setAnchor(null);
    await fetch("/api/auth/sign-out", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <>
      <IconButton
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-label={`Account: ${user.displayName ?? user.email}`}
        aria-haspopup="menu"
        sx={{ p: 0.5 }}
      >
        <Avatar
          sx={{
            width: 28,
            height: 28,
            fontSize: 12,
            fontWeight: 500,
            bgcolor: "primary.soft",
            color: "primary.main",
          }}
        >
          {initials(user)}
        </Avatar>
      </IconButton>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { maxWidth: 280, mt: 1 } } }}
      >
        <Stack spacing={0.5} sx={{ px: 2, py: 1.5 }}>
          <Typography variant="body1" noWrap>
            {user.displayName ?? user.email}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.muted" }} noWrap>
            {user.email}
          </Typography>
          <Stack direction="row" sx={{ pt: 0.5 }}>
            <RoleChip role={user.role} />
          </Stack>
        </Stack>
        <Divider />
        <MenuItem
          component={Link}
          href="/settings"
          onClick={() => setAnchor(null)}
        >
          Settings
        </MenuItem>
        <MenuItem onClick={signOut}>Sign out</MenuItem>
      </Menu>
    </>
  );
}
