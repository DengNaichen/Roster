import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Dropdown } from "./Dropdown";

const options = [
  { value: "", label: "All types" },
  { value: "bug", label: "Bug" },
  { value: "old", label: "Old", disabled: true },
];
const open = () => fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });

it("shows the selected label, including for the empty-string option", () => {
  const { rerender } = render(
    <Dropdown aria-label="Type" value="" onChange={() => {}} options={options} />,
  );
  expect(screen.getByRole("combobox", { name: "Type" }).textContent).toBe("All types");
  rerender(<Dropdown aria-label="Type" value="bug" onChange={() => {}} options={options} />);
  expect(screen.getByRole("combobox", { name: "Type" }).textContent).toBe("Bug");
});

it("reports real values, mapping the empty option back to an empty string", async () => {
  const changed = vi.fn();
  render(<Dropdown aria-label="Type" value="bug" onChange={changed} options={options} />);
  open();
  fireEvent.click(await screen.findByRole("option", { name: "All types" }));
  expect(changed).toHaveBeenCalledWith("", options[0]);
});

it("does not allow choosing a disabled option and shows the placeholder without a match", async () => {
  const changed = vi.fn();
  render(
    <Dropdown
      aria-label="Type"
      placeholder="Choose…"
      value="missing"
      onChange={changed}
      options={options}
    />,
  );
  expect(screen.getByRole("combobox").textContent).toBe("Choose…");
  open();
  expect((await screen.findByRole("option", { name: "Old" })).hasAttribute("data-disabled")).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("option", { name: "Old" }));
  expect(changed).not.toHaveBeenCalled();
});

it("keeps a required dropdown invalid until a value is chosen", () => {
  const { container, rerender } = render(
    <form>
      <Dropdown
        aria-label="Type"
        required
        value=""
        onChange={() => {}}
        options={options.slice(1)}
      />
    </form>,
  );
  const form = container.querySelector("form")!;
  expect(form.checkValidity()).toBe(false);
  rerender(
    <form>
      <Dropdown
        aria-label="Type"
        required
        value="bug"
        onChange={() => {}}
        options={options.slice(1)}
      />
    </form>,
  );
  expect(form.checkValidity()).toBe(true);
});
