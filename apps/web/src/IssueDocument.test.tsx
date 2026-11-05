import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IssueDocument, sanitizeIssueHtml, setCriterion } from "./IssueDocument";
import sample from "./test/fixtures/issue-document.html?raw";

it("renders a full HTML issue as semantic sections, numbered criteria and a table", () => {
  const { container } = render(<IssueDocument text={sample} />);
  expect(screen.getByRole("heading", { name: "05 · 验收条件" })).toBeTruthy();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(container.querySelectorAll(".issue-doc-criteria > li")).toHaveLength(5);
  expect(container.querySelector(".issue-doc-scope")).toBeTruthy();
});
it("removes executable HTML, unsafe links and classes that could affect the application", () => {
  const html = sanitizeIssueHtml(
    '<article><script>alert(1)</script><style>body{display:none}</style><iframe src="https://example.com"></iframe><svg onload="alert(1)"></svg><form><input name="location"></form><p onclick="alert(1)" style="position:fixed" class="detail issue-doc-lead" id="root">Readable</p><a href="javascript:alert(1)">Unsafe</a><a href="https://example.com">Safe</a></article>',
  );
  const { container } = render(<div dangerouslySetInnerHTML={{ __html: html }} />);
  expect(
    container.querySelector("script,style,iframe,svg,form,input,[onclick],[style],[id]"),
  ).toBeNull();
  expect(screen.getByText("Readable").className).toBe("issue-doc-lead");
  expect(screen.getByText("Unsafe").getAttribute("href")).toBeNull();
  expect(screen.getByRole("link", { name: "Safe" }).getAttribute("href")).toBe(
    "https://example.com",
  );
});
it("renders descriptions only as HTML and updates when the description changes", () => {
  const { rerender } = render(<IssueDocument text={"## Not a heading"} />);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.getByText("## Not a heading")).toBeTruthy();
  rerender(<IssueDocument text="<section><h2>Updated task</h2><p>Saved HTML</p></section>" />);
  expect(screen.getByRole("heading", { name: "Updated task" })).toBeTruthy();
});
const criteria =
  '<section><h2>验收条件</h2><ol class="issue-doc-criteria"><li class="issue-doc-done"><strong>可以识别阻塞。</strong>出现红色图标。</li><li>列表行为不受影响。</li></ol></section>';

it("shows acceptance criteria as checkboxes with saved progress", () => {
  const onCriterionChange = vi.fn();
  const { container } = render(
    <IssueDocument text={criteria} onCriterionChange={onCriterionChange} />,
  );
  const done = screen.getByRole("checkbox", { name: "可以识别阻塞。出现红色图标。" });
  const open = screen.getByRole("checkbox", { name: "列表行为不受影响。" });
  expect((done as HTMLInputElement).checked).toBe(true);
  expect((open as HTMLInputElement).checked).toBe(false);
  expect(container.querySelector(".issue-doc-progress")?.textContent).toBe("1/2");
  fireEvent.click(open);
  expect(onCriterionChange).toHaveBeenCalledWith({
    index: 1,
    text: "列表行为不受影响。",
    done: true,
  });
  expect((open as HTMLInputElement).checked).toBe(false);
});
it("shows criteria read-only when they cannot be changed", () => {
  render(<IssueDocument text={criteria} />);
  for (const box of screen.getAllByRole("checkbox"))
    expect((box as HTMLInputElement).disabled).toBe(true);
});
it("does not let authored HTML smuggle in its own checkboxes", () => {
  render(
    <IssueDocument
      text={'<ul><li><input type="checkbox" checked>Fake</li></ul>'}
      onCriterionChange={vi.fn()}
    />,
  );
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("checks one criterion in the stored source and keeps everything else", () => {
  const source = `<article>\n  <p data-note="kept">Intro</p>\n  ${criteria}\n</article>`;
  const updated = setCriterion(source, { index: 1, text: "列表行为不受影响。", done: true });
  expect(updated).toBe(
    source.replace("<li>列表行为不受影响。", '<li class="issue-doc-done">列表行为不受影响。'),
  );
  expect(setCriterion(updated, { index: 1, text: "列表行为不受影响。", done: false })).toBe(source);
  expect(() => setCriterion(source, { index: 1, text: "已被改写的条件", done: true })).toThrow(
    "Acceptance criteria changed",
  );
});
