/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import { NumericText } from "./NumericText";
import { EmptyState } from "./EmptyState";
import { StatusChip } from "./StatusChip";
import { RoleChip } from "./RoleChip";
import { HealthStateChip } from "./HealthStateChip";

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

describe("NumericText", () => {
  it("renders its value", () => {
    renderThemed(<NumericText>2026-09-14 03:12 ET</NumericText>);
    expect(screen.getByText("2026-09-14 03:12 ET")).toBeInTheDocument();
  });

  it("is never bold, at any size", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const { unmount } = renderThemed(
        <NumericText size={size}>61.4</NumericText>,
      );
      const weight = getComputedStyle(screen.getByText("61.4")).fontWeight;
      expect(["400", "normal", ""]).toContain(weight);
      unmount();
    }
  });
});

describe("EmptyState", () => {
  it("renders a title, optional detail, and an optional action", () => {
    renderThemed(
      <EmptyState
        title="The slate is not yet available."
        detail="Contract listings arrive with Kalshi market sync."
        action={{ label: "Go to slate", href: "/slate" }}
      />,
    );

    expect(
      screen.getByText("The slate is not yet available."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to slate" })).toHaveAttribute(
      "href",
      "/slate",
    );
  });

  it("renders no image, icon, or artwork", () => {
    const { container } = renderThemed(<EmptyState title="Nothing here." />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("StatusChip", () => {
  // Colour is never the only signal — the label is what actually communicates.
  it("always carries a text label", () => {
    for (const tone of ["neutral", "caution", "accent"] as const) {
      const { unmount } = renderThemed(
        <StatusChip label="Pending" tone={tone} />,
      );
      expect(screen.getByText("Pending")).toBeInTheDocument();
      unmount();
    }
  });
});

describe("RoleChip", () => {
  it("labels both roles", () => {
    const { unmount } = renderThemed(<RoleChip role="admin" />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    unmount();

    renderThemed(<RoleChip role="viewer" />);
    expect(screen.getByText("Viewer")).toBeInTheDocument();
  });
});

describe("HealthStateChip", () => {
  it("renders nothing for a healthy signal", () => {
    const { container } = renderThemed(<HealthStateChip state="ok" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the four unavailable states distinguishable", () => {
    const labels = (
      ["not_yet_implemented", "never_run", "not_expected", "failed"] as const
    ).map((state) => {
      const { container, unmount } = renderThemed(
        <HealthStateChip state={state} />,
      );
      const text = container.textContent ?? "";
      unmount();
      return text;
    });

    expect(new Set(labels).size).toBe(4);
  });

  it("gives the caution states an icon as well as a tint", () => {
    for (const state of ["late", "failed"] as const) {
      const { container, unmount } = renderThemed(
        <HealthStateChip state={state} />,
      );
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });
});
