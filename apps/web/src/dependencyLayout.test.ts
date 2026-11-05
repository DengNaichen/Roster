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
it("routes skip-level edges around cards and connects at their horizontal centers", () => {
  const layout = dependencyLayout(
    {
      nodes,
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "c" },
        { from: "a", to: "d" },
      ],
    },
    new Set(["b", "c", "d"]),
  );
  for (const edge of layout.edges) {
    const from = layout.nodes.find((n) => n.id === edge.from)!;
    const to = layout.nodes.find((n) => n.id === edge.to)!;
    expect(edge.points[0]).toEqual({ x: from.x + 236, y: from.y + 60 });
    expect(edge.points.at(-1)).toEqual({ x: to.x, y: to.y + 60 });
    expect(edge.points.at(-2)!.y).toBe(to.y + 60);
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1],
        b = edge.points[i];
      for (const node of layout.nodes) {
        const crosses =
          a.x === b.x
            ? a.x > node.x &&
              a.x < node.x + 236 &&
              Math.max(a.y, b.y) > node.y &&
              Math.min(a.y, b.y) < node.y + 120
            : a.y > node.y &&
              a.y < node.y + 120 &&
              Math.max(a.x, b.x) > node.x &&
              Math.min(a.x, b.x) < node.x + 236;
        expect(crosses).toBe(false);
      }
    }
  }
});
