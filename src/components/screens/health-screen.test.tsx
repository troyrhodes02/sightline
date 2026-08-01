/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import { Health } from "./Health";
import type { HealthDto, HealthSignalDto } from "@/lib/dto/health";

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

function signal(overrides: Partial<HealthSignalDto>): HealthSignalDto {
  return {
    key: "ingest",
    label: "Ingest",
    state: "ok",
    lastSuccessAt: "Sun 6:02 AM ET",
    lastSuccessAge: "5h 40m",
    expectedWithin: "26h of the last success",
    lastAttemptAt: "Sun 6:02 AM ET",
    lastAttemptOutcome: "succeeded",
    ...overrides,
  };
}

function dto(overrides: Partial<HealthDto>): HealthDto {
  return {
    signals: [
      signal({}),
      signal({ key: "recompute", label: "Projection recomputation" }),
      signal({ key: "price_refresh", label: "Price refresh" }),
    ],
    offseason: null,
    ...overrides,
  };
}

describe("Health screen", () => {
  it("renders the three signal blocks in fixed order with no chip when healthy", () => {
    const { container } = renderThemed(<Health health={dto({})} />);

    const labels = ["Ingest", "Projection recomputation", "Price refresh"];
    const positions = labels.map((l) =>
      (container.textContent ?? "").indexOf(l),
    );
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    // ok renders nothing: no state chip text anywhere on a green surface.
    for (const chip of [
      "Late",
      "Failed",
      "Running",
      "Never run",
      "Not expected",
    ]) {
      expect(screen.queryByText(chip)).toBeNull();
    }
  });

  it("renders an honest em dash — never a fabricated timestamp — for never_run", () => {
    renderThemed(
      <Health
        health={dto({
          signals: [
            signal({
              state: "never_run",
              lastSuccessAt: null,
              lastSuccessAge: null,
              lastAttemptAt: null,
              lastAttemptOutcome: null,
            }),
            signal({ key: "recompute", label: "Projection recomputation" }),
            signal({ key: "price_refresh", label: "Price refresh" }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Never run")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the in-flight attempt under the last success while running", () => {
    renderThemed(
      <Health
        health={dto({
          signals: [
            signal({
              state: "running",
              lastAttemptAt: "Sun 11:00 AM ET",
              lastAttemptOutcome: "running",
            }),
            signal({ key: "recompute", label: "Projection recomputation" }),
            signal({ key: "price_refresh", label: "Price refresh" }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Current attempt")).toBeInTheDocument();
    expect(screen.getByText("started Sun 11:00 AM ET")).toBeInTheDocument();
    // Last success stays visible — a running attempt hides nothing.
    expect(screen.getAllByText("Sun 6:02 AM ET").length).toBeGreaterThan(0);
  });

  it("renders per-source detail with required/optional qualifiers on a failed cycle", () => {
    renderThemed(
      <Health
        health={dto({
          signals: [
            signal({
              state: "failed",
              lastAttemptAt: "Sun 11:03 AM ET",
              lastAttemptOutcome: "failed",
              sources: [
                {
                  name: "schedule",
                  required: true,
                  state: "ok",
                  finishedAt: "Sun 11:02 AM ET",
                },
                {
                  name: "context",
                  required: true,
                  state: "failed",
                  finishedAt: "Sun 11:03 AM ET",
                },
                {
                  name: "weather",
                  required: false,
                  state: "degraded",
                  finishedAt: "Sun 11:03 AM ET",
                },
              ],
            }),
            signal({ key: "recompute", label: "Projection recomputation" }),
            signal({ key: "price_refresh", label: "Price refresh" }),
          ],
        })}
      />,
    );
    expect(screen.getByText("sources — latest cycle")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument(); // parent chip
    expect(screen.getByText("failed")).toBeInTheDocument(); // source word
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getAllByText("required").length).toBe(2);
    expect(screen.getByText("optional")).toBeInTheDocument();
  });

  it("renders per-game completeness naming games, never players", () => {
    renderThemed(
      <Health
        health={dto({
          signals: [
            signal({}),
            signal({
              key: "recompute",
              label: "Projection recomputation",
              state: "late",
              games: {
                currentCount: 12,
                totalCount: 14,
                lagging: [
                  {
                    label: "CIN @ BAL",
                    kickoffAt: "Sun 1:00 PM ET",
                    reason: "not recomputed this cycle",
                  },
                  {
                    label: "MIA @ NYJ",
                    kickoffAt: "Sun 1:00 PM ET",
                    reason: "failed this cycle",
                  },
                ],
              },
            }),
            signal({ key: "price_refresh", label: "Price refresh" }),
          ],
        })}
      />,
    );
    expect(screen.getByText("12 of 14 games current")).toBeInTheDocument();
    expect(screen.getByText("CIN @ BAL")).toBeInTheDocument();
    expect(screen.getByText("not recomputed this cycle")).toBeInTheDocument();
    expect(screen.getByText("failed this cycle")).toBeInTheDocument();
  });

  it("renders the offseason as dormant copy plus a neutral readiness block", () => {
    renderThemed(
      <Health
        health={dto({
          signals: [
            signal({ state: "not_expected", expectedWithin: null }),
            signal({
              key: "recompute",
              label: "Projection recomputation",
              state: "not_expected",
              expectedWithin: null,
            }),
            signal({
              key: "price_refresh",
              label: "Price refresh",
              state: "not_expected",
              expectedWithin: null,
            }),
          ],
          offseason: {
            dormantCopy:
              "Offseason. Scheduled jobs resume with the season schedule.",
            keepalive: {
              lastActedAt: "Jun 12, 9:00 AM ET",
              lastActedAge: "19d",
              nextRequiredBy: "Aug 1, 9:00 AM ET",
              overdue: false,
            },
          },
        })}
      />,
    );
    expect(
      screen.getByText(
        "Offseason. Scheduled jobs resume with the season schedule.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Offseason readiness")).toBeInTheDocument();
    expect(screen.getByText("Keepalive last acted")).toBeInTheDocument();
    expect(screen.getAllByText("Not expected").length).toBe(3);
    expect(screen.queryByText("overdue")).toBeNull();
    expect(
      screen.queryByText(/scheduled workflows may be disabled/),
    ).toBeNull();
  });

  it("turns the readiness block amber with the caution copy when the keepalive is overdue", () => {
    renderThemed(
      <Health
        health={dto({
          signals: [
            signal({ state: "not_expected", expectedWithin: null }),
            signal({
              key: "recompute",
              label: "Projection recomputation",
              state: "not_expected",
              expectedWithin: null,
            }),
            signal({
              key: "price_refresh",
              label: "Price refresh",
              state: "not_expected",
              expectedWithin: null,
            }),
          ],
          offseason: {
            dormantCopy:
              "Offseason. Scheduled jobs resume with the season schedule.",
            keepalive: {
              lastActedAt: "Apr 2, 9:00 AM ET",
              lastActedAge: "3mo",
              nextRequiredBy: "May 22, 9:00 AM ET",
              overdue: true,
            },
          },
        })}
      />,
    );
    expect(screen.getByText("overdue")).toBeInTheDocument();
    expect(
      screen.getByText(
        /keepalive overdue — scheduled workflows may be disabled/,
      ),
    ).toBeInTheDocument();
  });
});
