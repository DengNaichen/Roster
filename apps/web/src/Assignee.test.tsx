import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AssigneeFilter, AssigneeSelect } from "./Assignee";
import { deferred, json } from "./test/fixtures";

const open = (control: HTMLElement) => fireEvent.keyDown(control, { key: "ArrowDown" });

it("keeps the selected member visible while the filter directory loads", async () => {
  const members = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(() => members.promise));
  render(<AssigneeFilter value="user:member" currentLabel="Member" enabled onChange={() => {}} />);
  const control = screen.getByRole("combobox", { name: "Filter by assignee" });
  expect(control.textContent).toBe("Member");
  await act(async () => members.resolve(json({ members: [{ subject: "member", name: "Member", email: "", status: "active" }] })));
  expect(control.textContent).toBe("Member");
  open(control);
  const selected = await screen.findByRole("option", { name: "Member" });
  expect(selected.getAttribute("data-state")).toBe("checked");
  expect(selected.hasAttribute("data-disabled")).toBe(false);
});

it("retains an unavailable current assignee without offering new assignments to them", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ assignees: [{ subject: "admin", name: "Admin", email: "" }] }))));
  const { container } = render(<AssigneeSelect team="AL" value="member" current={{ subject: "member", name: "Member", email: "" }} onChange={() => {}} disabled={false} label="Assignee" />);
  const control = screen.getByRole("combobox", { name: "Assignee" }) as HTMLButtonElement;
  await waitFor(() => expect(control.disabled).toBe(false));
  expect(container.querySelector(".person-avatar")!.textContent).toBe("M");
  open(control);
  await screen.findByRole("option", { name: "Admin" });
  const selected = screen.getByRole("option", { name: "Member (unavailable)" });
  expect(selected.getAttribute("data-state")).toBe("checked");
  expect(selected.hasAttribute("data-disabled")).toBe(true);
  expect(screen.getByRole("option", { name: "Unassigned" }).hasAttribute("data-disabled")).toBe(false);
});
