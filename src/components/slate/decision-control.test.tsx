/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import { DecisionControl } from "./DecisionControl";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

describe("DecisionControl", () => {
  beforeEach(() => {
    refresh.mockClear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ decision: { disposition: "took" } }),
    }) as unknown as typeof fetch;
  });

  it("renders three equal-weight controls and nothing marked when unmarked", () => {
    renderThemed(<DecisionControl contractId="c1" current={null} />);
    expect(screen.getByRole("button", { name: "Take" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fade" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    for (const name of ["Take", "Fade", "Skip"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });

  it("posts only the contract id and disposition", async () => {
    renderThemed(<DecisionControl contractId="c1" current={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Take" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/decisions");
    expect(JSON.parse(options.body)).toEqual({
      contractId: "c1",
      disposition: "took",
    });
  });

  it("confirms with the design doc's snackbar copy", async () => {
    const first = renderThemed(
      <DecisionControl contractId="c1" current={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fade" }));
    expect(await screen.findByText("Marked as faded")).toBeInTheDocument();
    first.unmount();

    renderThemed(<DecisionControl contractId="c2" current="took" />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByText("Changed to skipped")).toBeInTheDocument();
  });

  it("re-tapping the active disposition does nothing", () => {
    renderThemed(<DecisionControl contractId="c1" current="took" />);
    fireEvent.click(screen.getByRole("button", { name: "Take" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps its prior state and shows the server's message on failure", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "invalid_state_transition",
        message: "This game has started. Decisions are closed.",
      }),
    });
    renderThemed(<DecisionControl contractId="c1" current={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Take" }));
    expect(
      await screen.findByText("This game has started. Decisions are closed."),
    ).toBeInTheDocument();
    // Nothing looks saved.
    expect(screen.getByRole("button", { name: "Take" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("answers T/F/S keys but not while typing in a field", async () => {
    renderThemed(
      <>
        <input aria-label="field" />
        <DecisionControl contractId="c1" current={null} />
      </>,
    );
    const field = screen.getByLabelText("field");
    field.focus();
    fireEvent.keyDown(field, { key: "t" });
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "t" });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });
});
