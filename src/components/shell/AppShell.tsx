"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import MenuIcon from "@mui/icons-material/Menu";

import { SightlineLockup } from "@/components/brand/SightlineLockup";
import { SightlineMark } from "@/components/brand/SightlineMark";
import { RoleChip } from "@/components/primitives/RoleChip";
import { AccountMenu } from "./AccountMenu";
import { visibleSections } from "./NavSections";
import type { SessionUserDto } from "@/lib/dto/session";

/**
 * The frame every authenticated surface sits inside.
 *
 * Rendered only after the session and role resolve server-side — the layout
 * above it awaits `requireSession()`, so there is no state in which navigation
 * is drawn and then corrected. That matters more than it sounds: a shell that
 * renders admin tabs and then removes them has already told a viewer the admin
 * layer exists.
 */
export function AppShell({
  user,
  children,
}: {
  user: SessionUserDto;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  const sections = visibleSections(user.role);
  const current = sections.find((s) => pathname.startsWith(s.href))?.href;
  const tabs = sections.filter((s) => !s.drawerOnly);

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      {/* First tabbable element on every page. */}
      <Box
        component="a"
        href="#main"
        sx={{
          position: "absolute",
          left: -9999,
          "&:focus": {
            left: 8,
            top: 8,
            zIndex: 1400,
            px: 2,
            py: 1,
            bgcolor: "background.paper",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
          },
        }}
      >
        Skip to content
      </Box>

      <AppBar position="sticky">
        <Toolbar sx={{ minHeight: 56, gap: 2, px: { xs: 2, sm: 3, md: 4 } }}>
          <IconButton
            edge="start"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            sx={{ display: { xs: "inline-flex", md: "none" }, mr: -1 }}
          >
            <MenuIcon sx={{ fontSize: 24 }} />
          </IconButton>

          <Box
            component={Link}
            href="/slate"
            sx={{ display: "flex", color: "text.primary" }}
          >
            <SightlineLockup
              height={20}
              sx={{ display: { xs: "none", sm: "block" } }}
            />
            <SightlineMark
              size={20}
              sx={{
                display: { xs: "block", sm: "none" },
                color: "text.primary",
              }}
            />
          </Box>

          <Tabs
            value={current ?? false}
            sx={{ display: { xs: "none", md: "flex" }, ml: 1 }}
          >
            {tabs.map((section) => (
              <Tab
                key={section.href}
                value={section.href}
                label={section.label}
                component={Link}
                href={section.href}
                aria-current={current === section.href ? "page" : undefined}
              />
            ))}
          </Tabs>

          <Box sx={{ flex: 1 }} />
          <AccountMenu user={user} />
        </Toolbar>
      </AppBar>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        variant="temporary"
        slotProps={{ paper: { sx: { width: 264 } } }}
      >
        <Toolbar sx={{ minHeight: 56, justifyContent: "space-between", px: 2 }}>
          <SightlineLockup height={20} />
          <IconButton
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            edge="end"
          >
            <CloseIcon sx={{ fontSize: 24 }} />
          </IconButton>
        </Toolbar>
        <Divider />
        <List disablePadding>
          {sections.map((section) => (
            <ListItemButton
              key={section.href}
              component={Link}
              href={section.href}
              selected={current === section.href}
              onClick={() => setDrawerOpen(false)}
              sx={{
                "&.Mui-selected": {
                  bgcolor: "primary.soft",
                  color: "primary.main",
                },
              }}
            >
              <ListItemText
                slotProps={{ primary: { variant: "body1" } }}
                primary={section.label}
              />
            </ListItemButton>
          ))}
        </List>
        <Divider />
        <Stack spacing={1} sx={{ p: 2 }}>
          <Typography variant="body1" noWrap>
            {user.displayName ?? user.email}
          </Typography>
          <Box>
            <RoleChip role={user.role} />
          </Box>
        </Stack>
      </Drawer>

      <Container
        component="main"
        id="main"
        maxWidth={false}
        sx={{
          maxWidth: 1280,
          px: { xs: 2, sm: 3, md: 4 },
          py: { xs: 3, md: 4 },
        }}
      >
        {children}
      </Container>
    </Box>
  );
}
