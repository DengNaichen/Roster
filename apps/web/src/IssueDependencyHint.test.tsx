import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { IssueDependencyHint, indexDependencies } from "./IssueDependencyHint";
import type { SpecDependencies } from "../../../packages/contracts/spec";

const graph: SpecDependencies = {
  nodes: [
    {
      id: "a",
      identifier: "RO-1",
      title: "Build schema",
      status: "in_progress",
      external: true,
      assignee: null,
    },
    {
      id: "b",
      identifier: "RO-2",
      title: "Build endpoint",
      status: "todo",
      external: false,
      assignee: null,
    },
    {
      id: "c",
      identifier: "RO-3",
      title: "Build list",
      status: "todo",
      external: false,
      assignee: null,
    },
    {
      id: "d",
      identifier: "RO-4",
      title: "Independent",
      status: "todo",
      external: false,
      assignee: null,
    },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
};
it("shows only direct dependencies and opens accessible task links", () => {
  const index = indexDependencies(graph);
  render(<IssueDependencyHint identifier="RO-2" status="todo" relation={index.get("RO-2")} />);
  fireEvent.click(screen.getByRole("button", { name: "RO-2 依赖关系：被 RO-1 阻塞" }));
  const dialog = screen.getByRole("dialog", { name: "RO-2 依赖关系" });
  expect(
    within(dialog)
      .getByRole("link", { name: /RO-1.*Build schema/ })
      .getAttribute("href"),
  ).toContain("/issue/RO-1");
  expect(within(dialog).getByRole("link", { name: /RO-3.*Build list/ })).toBeTruthy();
  expect(within(dialog).queryByText("Independent")).toBeNull();
  expect(index.get("RO-3")!.before.map((node) => node.identifier)).toEqual(["RO-2"]);
});
it("updates after prerequisites complete and leaves unrelated tasks unadorned", () => {
  const relation = indexDependencies(graph).get("RO-2")!;
  const { rerender } = render(
    <IssueDependencyHint identifier="RO-2" status="todo" relation={relation} />,
  );
  rerender(
    <IssueDependencyHint
      identifier="RO-2"
      status="todo"
      relation={{
        ...relation,
        before: relation.before.map((node) => ({ ...node, status: "done" })),
      }}
    />,
  );
  expect(screen.getByRole("button").textContent).toBe("前置已完成");
  rerender(<IssueDependencyHint identifier="RO-2" status="done" relation={relation} />);
  expect(screen.getByRole("button").textContent).toBe("前置 1 项");
  rerender(
    <IssueDependencyHint
      identifier="RO-4"
      status="todo"
      relation={indexDependencies(graph).get("RO-4")}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
});
