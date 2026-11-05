import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { DescriptionField } from "./DescriptionField";

function Field({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <DescriptionField value={value} onChange={setValue} disabled={false} />;
}

it("previews the description as the issue page renders it and keeps the source when returning", () => {
  render(<Field />);
  const html = '<section><h2>验收条件</h2><p onclick="alert(1)">可以识别阻塞</p></section>';
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: html },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  expect(screen.getByRole("heading", { name: "验收条件" })).toBeTruthy();
  expect(screen.getByText("可以识别阻塞").getAttribute("onclick")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Write" }));
  expect((screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe(
    html,
  );
});
it("says when there is nothing to preview", () => {
  render(<Field initial="   " />);
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  expect(screen.getByText("Nothing to preview")).toBeTruthy();
});
