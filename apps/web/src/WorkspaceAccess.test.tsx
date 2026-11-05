import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MembersSettings } from "./WorkspaceAccess";
import { api } from "./shared";
vi.mock("./shared", async (original) => ({
  ...(await original<typeof import("./shared")>()),
  api: vi.fn(),
}));
const members = [
  { subject: "a", name: "Ada", email: "ada@example.test", role: "admin", status: "active" },
  { subject: "b", name: "Bea", email: "bea@example.test", role: "member", status: "suspended" },
];
beforeEach(() => {
  history.replaceState(null, "", "/demo/settings/members");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (path.endsWith("/access"))
      return { enabled: true, role: "admin", subject: "owner" } as never;
    if (path.endsWith("/invite")) return { token: "example" } as never;
    if (method === "PATCH") return {} as never;
    return { members } as never;
  });
});
it("searches by email and moves restored members into the active group", async () => {
  render(<MembersSettings />);
  await screen.findByRole("button", { name: "Restore Bea" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search members" }), {
    target: { value: "bea@" },
  });
  expect(screen.queryByText("Ada")).toBeNull();
  expect(screen.getByText("Bea")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Restore Bea" }));
  await screen.findByRole("button", { name: "Suspend Bea" });
  expect(screen.queryByRole("rowheader", { name: /Inactive/ })).toBeNull();
  expect(api).toHaveBeenCalledWith("/api/w/demo/members", "PATCH", {
    subject: "b",
    role: "member",
    status: "active",
  });
});
it("opens the invitation dialog without rotating the invitation until requested", async () => {
  render(<MembersSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Invite" }));
  expect(vi.mocked(api).mock.calls.some(([path]) => path.endsWith("/invite"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Create invitation link" }));
  const field = await screen.findByRole("textbox", { name: "Invitation link" });
  expect((field as HTMLInputElement).value).toContain("/auth/join?token=example");
  expect(vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/invite"))).toHaveLength(1);
});
it("keeps membership controls read-only for non-admins", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith("/access")
      ? ({ enabled: true, role: "member", subject: "a" } as never)
      : ({ members } as never),
  );
  render(<MembersSettings />);
  await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Restore Bea" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Role for Ada" })).toBeNull();
});
