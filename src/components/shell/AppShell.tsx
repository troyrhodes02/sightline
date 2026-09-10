"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MenuIcon from "@mui/icons-material/Menu";

import { SightlineLockup } from "@/components/brand/SightlineLockup";
import { SightlineMark } from "@/components/brand/SightlineMark";
import { RoleChip } from "@/components/primitives/RoleChip";
import { AccountMenu } from "./AccountMenu";
import { adminSections, primaryTabs, visibleSections } from "./NavSections";
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
  const [adminAnchor, setAdminAnchor] = useState<null | HTMLElement>(null);
  const pathname = usePathname();

  const sections = visibleSections(user.role);
  const current = sections.find((s) => pathname.startsWith(s.href))?.href;
  const tabs = primaryTabs(user.role);
  const admin = adminSections(user.role);
  const adminActive = admin.some((s) => pathname.startsWith(s.href));

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
        <Toolbar sx={{ minHeight: 60, gap: 2, px: { xs: 2, sm: 3, md: 4 } }}>
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
              height={22}
              sx={{ display: { xs: "none", sm: "block" } }}
            />
            <SightlineMark
              size={22}
              sx={{
                display: { xs: "block", sm: "none" },
                color: "text.primary",
              }}
            />
          </Box>

          <Tabs
            value={adminActive ? false : (current ?? false)}
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

          {admin.length > 0 && (
            <Box
              sx={{ display: { xs: "none", md: "flex" }, alignItems: "center" }}
            >
              <Button
                id="admin-menu-button"
                endIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
                aria-haspopup="menu"
                aria-controls={adminAnchor ? "admin-menu" : undefined}
                aria-expanded={adminAnchor ? "true" : undefined}
                aria-current={adminActive ? "page" : undefined}
                onClick={(e) => setAdminAnchor(e.currentTarget)}
                sx={{
                  minHeight: 60,
                  px: 2,
                  borderRadius: 0,
                  fontWeight: 500,
                  color: adminActive ? "primary.main" : "text.secondary",
                }}
              >
                Admin
              </Button>
              <Menu
                id="admin-menu"
                anchorEl={adminAnchor}
                open={Boolean(adminAnchor)}
                onClose={() => setAdminAnchor(null)}
                slotProps={{ list: { "aria-labelledby": "admin-menu-button" } }}
              >
                {admin.map((section) => (
                  <MenuItem
                    key={section.href}
                    component={Link}
                    href={section.href}
                    selected={current === section.href}
                    onClick={() => setAdminAnchor(null)}
                  >
                    {section.label}
                  </MenuItem>
                ))}
              </Menu>
            </Box>
          )}

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
        <Toolbar sx={{ minHeight: 60, justifyContent: "space-between", px: 2 }}>
          <SightlineLockup height={22} />
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
          {sections
            .filter((s) => !s.adminGroup)
            .map((section) => (
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
          {admin.length > 0 && (
            <>
              <ListSubheader
                disableSticky
                sx={{ bgcolor: "transparent", lineHeight: "36px" }}
              >
                Admin
              </ListSubheader>
              {admin.map((section) => (
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
            </>
          )}
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
