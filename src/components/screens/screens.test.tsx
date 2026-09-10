/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import { AccessDenied, NotFound } from "./Terminal";
import { AppShell } from "@/components/shell/AppShell";
import type { SessionUserDto } from "@/lib/dto/session";

jest.mock("next/navigation", () => ({
  usePathname: () => "/slate",
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

const VIEWER: SessionUserDto = {
  id: "v1",
  email: "dana@example.com",
  displayName: "Dana Whitfield",
  role: "viewer",
};

const ADMIN: SessionUserDto = {
  id: "a1",
  email: "wtrhodes02@gmail.com",
  displayName: "William Rhodes",
  role: "admin",
};

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

describe("AppShell", () => {
  it("renders no admin navigation for a viewer", () => {
    const { container } = renderThemed(
      <AppShell user={VIEWER}>
        <div />
      </AppShell>,
    );

    // Asserting the MARKUP, not visibility: a hidden-but-present nav entry
    // still tells a viewer the admin layer exists.
    expect(container.innerHTML).not.toMatch(/\/health|\/users/);
    expect(screen.queryByText("Health")).toBeNull();
    expect(screen.queryByText("Users")).toBeNull();
  });

  it("gathers admin navigation behind an Admin control for an admin", () => {
    // Pitch 10 moved the admin surfaces out of the primary tabs into an "Admin"
    // control. The control exists for the admin; its items live in the menu it
    // opens (not mounted until opened), so the presence of the control is the
    // assertion here.
    renderThemed(
      <AppShell user={ADMIN}>
        <div />
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: /Admin/ })).toBeInTheDocument();
    // The two viewer-facing primary tabs are present (MUI Tab → role "tab").
    expect(screen.getByRole("tab", { name: "Slate" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Prop Research" }),
    ).toBeInTheDocument();
  });

  it("offers no Admin control to a viewer", () => {
    renderThemed(
      <AppShell user={VIEWER}>
        <div />
      </AppShell>,
    );
    expect(screen.queryByRole("button", { name: /Admin/ })).toBeNull();
  });

  it("puts a skip link first in the tab order", () => {
    const { container } = renderThemed(
      <AppShell user={ADMIN}>
        <div />
      </AppShell>,
    );
    const first = container.querySelector("a");
    expect(first).toHaveTextContent("Skip to content");
  });

  it("offers no appearance control", () => {
    const { container } = renderThemed(
      <AppShell user={ADMIN}>
        <div />
      </AppShell>,
    );
    // Appearance lives in Settings and nowhere else.
    expect(container.textContent).not.toMatch(/light|dark|appearance|theme/i);
  });

  it("falls back to the email when no display name is set", () => {
    renderThemed(
      <AppShell user={{ ...ADMIN, displayName: null }}>
        <div />
      </AppShell>,
    );

    // The name appears in the account control's accessible label and in the
    // drawer; both read through the same fallback. Asserting the label keeps
    // this a test of the fallback rather than of the drawer's open state.
    expect(
      screen.getByRole("button", { name: "Account: wtrhodes02@gmail.com" }),
    ).toBeInTheDocument();
  });
});

describe("terminal states", () => {
  it("denies without naming the feature or its data", () => {
    const { container } = renderThemed(<AccessDenied />);
    expect(
      screen.getByText("You do not have access to this page."),
    ).toBeInTheDocument();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(
      /admin|health|users|decision|permission|request access/i,
    );
  });

  it("routes not-found back to the slate", () => {
    renderThemed(<NotFound />);
    expect(screen.getByRole("link", { name: "Go to slate" })).toHaveAttribute(
      "href",
      "/slate",
    );
  });
});
