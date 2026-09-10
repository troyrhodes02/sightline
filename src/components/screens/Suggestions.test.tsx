/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import {
  ReliabilityView,
  ReliabilityTile,
  type SourceReliabilityDto,
} from "./Suggestions";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

describe("ReliabilityTile — sample gating", () => {
  it("shows the percentage when there is enough evidence", () => {
    renderThemed(
      <ReliabilityTile
        title="Source accuracy"
        caption="was the claim correct?"
        rate={{ numerator: 46, denominator: 50, rate: 0.92 }}
        unit="reports"
      />,
    );
    expect(screen.getByText("92.0%")).toBeInTheDocument();
    expect(screen.getByText("46 of 50 reports")).toBeInTheDocument();
  });

  it("withholds the percentage below the minimum but always shows the count", () => {
    renderThemed(
      <ReliabilityTile
        title="Source accuracy"
        caption="was the claim correct?"
        rate={{ numerator: 3, denominator: 3, rate: null }}
        unit="reports"
      />,
    );
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    expect(screen.getByText("not enough evidence yet")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 reports")).toBeInTheDocument();
  });
});

describe("ReliabilityView — two figures, never merged", () => {
  const dto: SourceReliabilityDto = {
    source: "espn",
    sourceAccuracy: { numerator: 46, denominator: 50, rate: 0.92 },
    adjustmentAccuracy: { numerator: 19, denominator: 31, rate: 19 / 31 },
    adjustmentBreakdown: { improved: 19, hurt: 9, neutral: 3 },
    minSample: 15,
  };

  it("renders Source Accuracy and Adjustment Accuracy as two distinct tiles", () => {
    renderThemed(<ReliabilityView reliability={[dto]} />);
    expect(screen.getByText("Source accuracy")).toBeInTheDocument();
    expect(screen.getByText("Adjustment accuracy")).toBeInTheDocument();
    expect(screen.getByText("was the claim correct?")).toBeInTheDocument();
    expect(screen.getByText("did reacting help?")).toBeInTheDocument();
    // The explainer makes explicit they are not one number.
    expect(screen.getByText(/never combined/i)).toBeInTheDocument();
  });
});
