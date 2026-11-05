import { it, expect } from "vitest";
import { dependencyLayout } from "./dependencyLayout";
import type { SpecDependencies } from "../../../packages/contracts/spec";
const nodes: SpecDependencies["nodes"] = ["a", "b", "c", "d"].map((id) => ({
  id,
  identifier: id,
  title: id,
  status: "todo",
  external: id === "a",
  assignee: null,
}));
it("keeps external ancestors and lays out a fork and join from left to right", () => {
  const graph = {
    nodes,
    edges: [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ],
  };
  const layout = dependencyLayout(graph, new Set(["d"]));
  expect(layout.nodes).toHaveLength(4);
  for (const e of layout.edges)
    expect(layout.nodes.find((n) => n.id === e.from)!.x).toBeLessThan(
      layout.nodes.find((n) => n.id === e.to)!.x,
    );
  expect(dependencyLayout(graph, new Set()).nodes).toHaveLength(0);
});
it("lays out disconnected nodes and rejects cyclic input", () => {
  expect(dependencyLayout({ nodes, edges: [] }, new Set(["b", "c", "d"])).nodes).toHaveLength(3);
  expect(() =>
    dependencyLayout(
      {
        nodes,
        edges: [
          { from: "b", to: "c" },
          { from: "c", to: "b" },
        ],
      },
      new Set(["b"]),
    ),
  ).toThrow("cycle");
});
