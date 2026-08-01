/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import { SignIn } from "./SignIn";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

function renderSignIn(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <SignIn {...props} />
    </ThemeProvider>,
  );
}

describe("SignIn", () => {
  it("offers email and password and nothing else", () => {
    renderSignIn();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  // The absence of these is a product commitment, so it is asserted rather
  // than assumed to survive future edits.
  it("has no signup, recovery, or social-auth affordance", () => {
    const { container } = renderSignIn();
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/sign up|create an account|register/i);
    expect(text).not.toMatch(/forgot|reset your password/i);
    expect(text).not.toMatch(/continue with|google|github|apple/i);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("states the access model, so the missing signup path reads as deliberate", () => {
    renderSignIn();
    expect(
      screen.getByText("Access to Sightline is by invitation."),
    ).toBeInTheDocument();
  });

  it("explains a revoked session without explaining why", () => {
    const { container } = renderSignIn({ revoked: true });
    expect(
      screen.getByText("Your access to Sightline has been removed."),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/admin|revoked by|because/i);
  });
});
