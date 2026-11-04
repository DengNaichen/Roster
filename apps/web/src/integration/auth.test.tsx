import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  oauthError: false,
  signedIn: true,
  signInWithOAuth: vi.fn(),
  callback: null as null | ((event: string, session: unknown) => void),
}));
const session = {
  user: {
    id: "test-user",
    email: "member@example.com",
    user_metadata: { name: "Member" },
  },
};
vi.mock("./api", () => ({
  configured: true,
  localPreview: false,
  api: vi.fn(),
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: auth.signedIn ? session : null },
        error: null,
      })),
      signInWithOAuth: auth.signInWithOAuth,
      onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
        auth.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      oauth: {
        getAuthorizationDetails: vi.fn(async () =>
          auth.oauthError
            ? { data: null, error: new Error("Consent unavailable") }
            : {
                data: {
                  authorization_id: "stale-id",
                  client: { name: "Stale client" },
                  scope: "openid",
                },
                error: null,
              },
        ),
        approveAuthorization: vi.fn(),
        denyAuthorization: vi.fn(),
      },
      signOut: vi.fn(async () => ({ error: null })),
    },
  },
}));
import { AuthBoundary } from "./auth";
afterEach(() => {
  window.history.replaceState({}, "", "/");
  auth.oauthError = false;
  auth.signedIn = true;
});
describe("authentication recovery", () => {
  it("keeps the mounted app and its draft when the session expires and recovers", async () => {
    render(
      <AuthBoundary>
        <textarea aria-label="Draft" defaultValue="Unsaved text" />
      </AuthBoundary>,
    );
    await screen.findByRole("textbox", { name: "Draft" });
    const draft = screen.getByRole("textbox", { name: "Draft" });
    await act(async () => {
      auth.callback?.("SIGNED_OUT", null);
    });
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
    expect(screen.getByText(/Your unsaved text stays here/)).toBeTruthy();
    await act(async () => {
      auth.callback?.("SIGNED_IN", session);
    });
    await waitFor(() => expect(screen.queryByText(/Your unsaved text stays here/)).toBeNull());
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  });
});

it("remounts the app when a different user signs in", async () => {
  render(
    <AuthBoundary>
      <textarea aria-label="Draft" defaultValue="New draft" />
    </AuthBoundary>,
  );
  const before = await screen.findByRole("textbox", { name: "Draft" });
  await act(async () => {
    auth.callback?.("SIGNED_IN", {
      user: {
        id: "different-user",
        email: "other@example.com",
        user_metadata: {},
      },
    });
  });
  expect(screen.getByRole("textbox", { name: "Draft" })).not.toBe(before);
});
it("does not approve stale authorization details", async () => {
  window.history.replaceState({}, "", "/oauth/consent?authorization_id=current-id");
  render(
    <AuthBoundary>
      <p>Application</p>
    </AuthBoundary>,
  );
  const approve = await screen.findByRole("button", { name: "Approve" });
  await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(true));
  expect(screen.queryByText("Stale client")).toBeNull();
});
it("shows consent errors without a loading message", async () => {
  auth.oauthError = true;
  window.history.replaceState({}, "", "/oauth/consent?authorization_id=current-id");
  render(
    <AuthBoundary>
      <p>Application</p>
    </AuthBoundary>,
  );
  await screen.findByText("Consent unavailable");
  expect(screen.queryByText("Loading authorization…")).toBeNull();
});

it.each([
  ["Google", "/join?token=invite", "/join?token=invite"],
  ["GitHub", "/oauth/consent?authorization_id=request", "/oauth/consent?authorization_id=request"],
  ["Google", "/auth/login?return_to=%2F..%2F%2Fevil.example", "/"],
])("starts %s OAuth from %s and allows retry on failure", async (name, from, target) => {
  auth.signedIn = false;
  auth.signInWithOAuth.mockResolvedValue({ error: new Error("Provider unavailable") });
  window.history.replaceState({}, "", from);
  render(<AuthBoundary>Workspace</AuthBoundary>);
  const button = await screen.findByRole("button", { name: "Continue with " + name });
  fireEvent.click(button);
  await screen.findByRole("alert");
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("return_to", target);
  expect(auth.signInWithOAuth).toHaveBeenLastCalledWith({
    provider: name.toLowerCase(),
    options: { redirectTo: callback.href },
  });
  expect((button as HTMLButtonElement).disabled).toBe(false);
});
