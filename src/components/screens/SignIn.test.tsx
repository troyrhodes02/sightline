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

  it("has no recovery or social-auth affordance", () => {
    // Their absence is a product commitment, so it is asserted rather than
    // assumed to survive future edits.
    const { container } = renderSignIn();
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/forgot|reset your password/i);
    expect(text).not.toMatch(/continue with|google|github|apple/i);
  });

  it("links to the request form, and only there", () => {
    renderSignIn();
    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/sign-up");
  });

  it("says a request is reviewed, so the link does not read as open signup", () => {
    renderSignIn();
    expect(
      screen.getByText(/every request is reviewed by an admin/i),
    ).toBeInTheDocument();
  });

  it.each([
    ["pending", /awaiting approval/i],
    ["denied", /was not approved/i],
    ["revoked", /has been removed/i],
  ])("explains a %s account without explaining why", (reason, expected) => {
    const { container, unmount } = renderSignIn({ reason });

    expect(screen.getByText(expected)).toBeInTheDocument();
    // The product has no opinion to offer, and a reason invites an argument.
    expect(container.textContent).not.toMatch(/because|admin decided|sorry/i);
    unmount();
  });
});
