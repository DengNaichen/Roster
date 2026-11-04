import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CycleSelect, emptyCycles } from "./Cycles";
import { CycleSettingsSection, mondayOf } from "./CycleSettings";
import CyclesPage from "./CyclesPage";
import { deferred, json } from "./test/fixtures";

beforeEach(() => {
  window.history.replaceState(null, "", "/default/team/AL/cycles");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
it("retries failed cycle reads and keeps the selected value", async () => {
  let failed = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        failed
          ? json({ error: "Offline" }, 500)
          : json({
              ...emptyCycles,
              settings: { ...emptyCycles.settings, enabled: true },
              cycles: [{ id: 1, number: 1, name: "Focus", state: "current" }],
            }),
      ),
    ),
  );
  const changed = vi.fn();
  render(<CycleSelect team="AL" value={1} onChange={changed} />);
  await screen.findByText("Offline");
  const control = screen.getByRole("combobox") as HTMLButtonElement;
  expect(control.textContent).toContain("Cycle unavailable");
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry cycles" }));
  await waitFor(() => expect(control.disabled).toBe(false));
  expect(control.textContent).toContain("Focus · current");
  fireEvent.keyDown(control, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "No cycle" }));
  expect(changed).toHaveBeenCalledWith(0);
});
it("snaps any chosen day to its Monday", () => {
  expect(mondayOf("2026-11-04")).toBe("2026-11-02");
  expect(mondayOf("2026-11-02")).toBe("2026-11-02");
  expect(mondayOf("2026-11-08")).toBe("2026-11-02");
});
it("defaults new team cycles to Mondays and one week, and keeps drafts after a failed save", async () => {
  const save = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? save.promise : Promise.resolve(json(emptyCycles)),
    ),
  );
  render(<CycleSettingsSection team="AL" canManage />);
  const start = (await screen.findByLabelText("First Monday")) as HTMLInputElement;
  expect(new Date(`${start.value}T00:00:00Z`).getUTCDay()).toBe(1);
  expect((screen.getByLabelText("Weeks per cycle") as HTMLInputElement).value).toBe("1");
  fireEvent.change(start, { target: { value: "2026-11-04" } });
  expect(start.value).toBe("2026-11-02");
  fireEvent.change(screen.getByLabelText("Weeks per cycle"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await act(async () => save.resolve(json({ error: "Offline" }, 500)));
  await screen.findByText("Offline");
  expect((screen.getByLabelText("Weeks per cycle") as HTMLInputElement).value).toBe("3");
});
it("shows cycle settings read-only without manage access", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(emptyCycles))));
  render(<CycleSettingsSection team="AL" canManage={false} />);
  expect(((await screen.findByLabelText("First Monday")) as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});
it("lists cycles newest first and expands only the current one", async () => {
  const day = 86_400_000;
  const cycle = (number: number, state: string, start: number, total: number, done: number) => ({
    id: number,
    team: "AL",
    number,
    name: "",
    description: "",
    timezone: "UTC",
    starts_at: new Date(Date.now() + start * day).toISOString(),
    ends_at: new Date(Date.now() + (start + 14) * day).toISOString(),
    completed_at: state === "completed" ? new Date().toISOString() : null,
    state,
    total,
    done,
    canceled: 0,
    rolled_over: total - done,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        json({
          settings: { ...emptyCycles.settings, enabled: true },
          cycles: [
            cycle(1, "completed", -20, 10, 5),
            cycle(2, "current", -3, 8, 2),
            cycle(3, "upcoming", 11, 0, 0),
          ],
        }),
      ),
    ),
  );
  render(<CyclesPage team="AL" teams={[]} />);
  const names = (await screen.findAllByRole("heading", { level: 2 })).map((h) => h.textContent);
  expect(names).toEqual(["Cycle 3", "Cycle 2", "Cycle 1"]);
  expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  expect(screen.getByText("50% success")).toBeTruthy();
  expect(screen.getByText("5 carried over")).toBeTruthy();
  expect(screen.getByText("10 issues")).toBeTruthy();
  expect(screen.queryByText(/scope/i)).toBeNull();
});
