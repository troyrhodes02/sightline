/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import { SightlineLockup } from "./SightlineLockup";
import { SightlineMark } from "./SightlineMark";

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

describe("brand marks", () => {
  it("names the product for assistive technology", () => {
    renderThemed(<SightlineLockup />);
    expect(screen.getByRole("img", { name: "Sightline" })).toBeInTheDocument();
  });

  it("holds the lockup to its supplied aspect ratio", () => {
    const { container } = renderThemed(<SightlineLockup height={28} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 226 52");
  });

  it("draws the mark entirely in currentColor, so it adapts to both modes", () => {
    const { container } = renderThemed(<SightlineMark />);
    const markup = container.innerHTML;

    expect(markup).toContain("currentColor");
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("does not add a wordmark to the mark used alone", () => {
    const { container } = renderThemed(<SightlineMark />);
    expect(container.querySelector("text")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
