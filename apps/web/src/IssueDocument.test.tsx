import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { IssueDocument, sanitizeIssueHtml } from "./IssueDocument";
import sample from "./test/fixtures/issue-document.html?raw";

it("renders a full HTML issue as semantic sections, numbered criteria and a table", () => {
  const { container } = render(<IssueDocument text={sample} />);
  expect(screen.getByRole("heading", { name: "05 · 验收条件" })).toBeTruthy();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(container.querySelectorAll(".issue-doc-criteria > li")).toHaveLength(5);
  expect(container.querySelector(".issue-doc-scope")).toBeTruthy();
  expect(container.querySelector(".markdown")).toBeNull();
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
it("keeps existing Markdown readable and updates when the description changes to HTML", () => {
  const { rerender } = render(
    <IssueDocument text={"## Existing task\n\nKeep **this description**."} />,
  );
  expect(screen.getByRole("heading", { name: "Existing task" })).toBeTruthy();
  rerender(<IssueDocument text="<section><h2>Updated task</h2><p>Saved HTML</p></section>" />);
  expect(screen.getByRole("heading", { name: "Updated task" })).toBeTruthy();
  expect(screen.queryByText("Existing task")).toBeNull();
});
