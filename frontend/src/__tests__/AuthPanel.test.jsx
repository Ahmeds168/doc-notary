import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";

const { auth, reset, widgetRendered } = vi.hoisted(() => ({
  auth: { signInWithPassword: vi.fn(), signUp: vi.fn() },
  reset: vi.fn(),
  widgetRendered: vi.fn(), // records the props of each widget render
}));
const widgetProps = () => widgetRendered.mock.lastCall[0];

vi.mock("../lib/supabase.js", () => ({ supabase: { auth } }));

// Stand-in for Cloudflare's widget: buttons that fire its callbacks, and a ref with reset().
vi.mock("@marsidev/react-turnstile", () => {
  let n = 0;
  return {
    Turnstile: forwardRef(function Turnstile(props, ref) {
      widgetRendered(props);
      useImperativeHandle(ref, () => ({ reset }));
      return (
        <div data-testid="turnstile" data-sitekey={props.siteKey}>
          <button type="button" onClick={() => props.onSuccess(`tok-${++n}`)}>Solve captcha</button>
          <button type="button" onClick={() => props.onExpire()}>Expire captcha</button>
          <button type="button" onClick={() => props.onError()}>Break captcha</button>
        </div>
      );
    }),
  };
});

import { AuthPanel } from "../components/AuthPanel.jsx";

const SITE_KEY = "0x4AAAAAAFmaiNkxDcFK5lnx";

function fill(email = "a@example.com", password = "correct horse") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}
// The mode toggle is also labelled "Sign in", so target the form's submit button.
const submitButton = (name) => {
  const button = document.querySelector('form button[type="submit"]');
  expect(button.textContent).toBe(name);
  return button;
};

beforeEach(() => {
  auth.signInWithPassword.mockReset().mockResolvedValue({ data: { session: {} }, error: null });
  auth.signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  reset.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("AuthPanel with Turnstile", () => {
  beforeEach(() => vi.stubEnv("VITE_TURNSTILE_SITE_KEY", SITE_KEY));

  it("renders the widget with the site key and keeps submit disabled until a token exists", () => {
    render(<AuthPanel reason="r" />);
    expect(screen.getByTestId("turnstile").dataset.sitekey).toBe(SITE_KEY);
    expect(widgetProps().options).toMatchObject({ size: "flexible" });
    fill();
    expect(submitButton("Sign in").disabled).toBe(true);
    fireEvent.click(screen.getByText("Solve captcha"));
    expect(submitButton("Sign in").disabled).toBe(false);
  });

  it("passes captchaToken to signInWithPassword, then resets the widget and requires a new token", async () => {
    render(<AuthPanel reason="r" />);
    fill("me@example.com", "pw-12345678");
    fireEvent.click(screen.getByText("Solve captcha"));
    fireEvent.click(submitButton("Sign in"));

    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledTimes(1));
    const [args] = auth.signInWithPassword.mock.calls[0];
    expect(args.email).toBe("me@example.com");
    expect(args.password).toBe("pw-12345678");
    expect(args.options.captchaToken).toMatch(/^tok-\d+$/);
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    expect(submitButton("Sign in").disabled).toBe(true); // single-use token consumed
  });

  it("passes captchaToken to signUp and resets after a failed attempt too", async () => {
    auth.signUp.mockResolvedValue({ data: null, error: { message: "captcha protection: request disallowed" } });
    render(<AuthPanel reason="r" />);
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fill();
    fireEvent.click(screen.getByText("Solve captcha"));
    fireEvent.click(submitButton("Create free account"));

    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1));
    expect(auth.signUp.mock.calls[0][0].options.captchaToken).toMatch(/^tok-\d+$/);
    expect(await screen.findByText(/request disallowed/)).toBeTruthy();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(submitButton("Create free account").disabled).toBe(true);
  });

  it("resets the widget even when the auth call throws, and shows a friendly error", async () => {
    auth.signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AuthPanel reason="r" />);
    fill();
    fireEvent.click(screen.getByText("Solve captcha"));
    fireEvent.click(submitButton("Sign in"));
    expect(await screen.findByText(/Couldn't reach the sign-in service/)).toBeTruthy();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows friendly messages when the check expires or fails, and disables submit", () => {
    render(<AuthPanel reason="r" />);
    fill();
    fireEvent.click(screen.getByText("Solve captcha"));
    fireEvent.click(screen.getByText("Expire captcha"));
    expect(screen.getByRole("alert").textContent).toMatch(/expired/);
    expect(submitButton("Sign in").disabled).toBe(true);

    fireEvent.click(screen.getByText("Break captcha"));
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the human check/);

    fireEvent.click(screen.getByText("Solve captcha"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(submitButton("Sign in").disabled).toBe(false);
  });

  it("treats a script-load failure (e.g. blocked by a content blocker) as a friendly error", () => {
    render(<AuthPanel reason="r" />);
    expect(typeof widgetProps().scriptOptions?.onError).toBe("function");
  });
});

describe("AuthPanel without a site key (local dev)", () => {
  beforeEach(() => vi.stubEnv("VITE_TURNSTILE_SITE_KEY", ""));

  it("renders no widget and calls Supabase without captchaToken", async () => {
    render(<AuthPanel reason="r" />);
    expect(screen.queryByTestId("turnstile")).toBeNull();
    fill();
    expect(submitButton("Sign in").disabled).toBe(false);
    fireEvent.click(submitButton("Sign in"));
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledTimes(1));
    expect(auth.signInWithPassword.mock.calls[0][0].options?.captchaToken).toBeUndefined();
    expect(reset).not.toHaveBeenCalled();
  });
});
