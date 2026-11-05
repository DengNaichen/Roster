import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IssueDocument } from "./IssueDocument";
import { sampleDocument } from "./test/fixtures/issueDocument";

it("renders a structured issue as numbered sections ending with acceptance criteria", () => {
  const { container } = render(<IssueDocument document={sampleDocument} />);
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
    "01 · 交付目标",
    "02 · 工作范围",
    "03 · 展示与交互",
    "04 · 实施约束",
    "05 · Acceptance criteria 1/2",
  ]);
  expect(container.querySelector(".issue-doc-lead")?.textContent).toBe(sampleDocument.lead);
  expect(
    screen.getByRole("heading", { name: "本次包含" }).closest(".issue-doc-scope"),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "本次不包含" }).closest(".issue-doc-scope"),
  ).toBeNull();
  expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
    "任务情况",
    "列表中的提示",
  ]);
  expect(screen.getByRole("complementary").textContent).toContain("隐藏任务不能通过数量泄露");
  expect(screen.getByText("GET /specs/:identifier/dependencies").tagName).toBe("CODE");
});
it("shows authored text literally, never as markup", () => {
  render(
    <IssueDocument
      document={{
        lead: '<img src=x onerror="alert(1)"> **not bold**',
        sections: [],
        criteria: [],
      }}
    />,
  );
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText('<img src=x onerror="alert(1)"> **not bold**')).toBeTruthy();
});
it("reports criterion changes by ID and shows them read-only without a handler", () => {
  const onCriterionChange = vi.fn();
  const { rerender } = render(
    <IssueDocument document={sampleDocument} onCriterionChange={onCriterionChange} />,
  );
  const criteria = within(screen.getByRole("region", { name: "Acceptance criteria" }));
  const done = criteria.getByRole("checkbox", { name: "可以识别阻塞。" }) as HTMLInputElement;
  const open = criteria.getByRole("checkbox", { name: "列表行为不受影响。" }) as HTMLInputElement;
  expect([done.checked, open.checked]).toEqual([true, false]);
  fireEvent.click(open);
  expect(onCriterionChange).toHaveBeenCalledWith("AC-2", true);
  rerender(<IssueDocument document={sampleDocument} />);
  for (const box of screen.getAllByRole("checkbox"))
    expect((box as HTMLInputElement).disabled).toBe(true);
});
it("renders nothing for an empty document", () => {
  const { container } = render(
    <IssueDocument document={{ lead: "", sections: [], criteria: [] }} />,
  );
  expect(container.innerHTML).toBe("");
});
