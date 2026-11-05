import { it, expect } from "vitest";
import { dependencyLayout, dependencyFocus } from "./dependencyLayout";
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
it("connects Bezier curves horizontally at card centers", () => {
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
    expect(edge.points[1].y).toBe(from.y + 60);
    expect(edge.points[1].x).toBeGreaterThan(edge.points[0].x);
    expect(edge.points.at(-2)!.x).toBeLessThan(to.x);
    expect(edge.path).toContain(" C");
    expect(edge.points.at(-2)).toEqual({ x: to.x - 18, y: to.y + 60 });
    expect(edge.path.endsWith(` L${to.x - 7},${to.y + 60}`)).toBe(true);
  }
});

it("focuses the upstream and downstream chains without pulling in siblings", () => {
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "a", to: "d" },
    { from: "c", to: "e" },
  ];
  const focus = dependencyFocus(edges, "b");
  expect([...focus.ancestors]).toEqual(["a"]);
  expect([...focus.descendants]).toEqual(["c", "e"]);
  expect(focus.nodes.has("d")).toBe(false);
  expect(focus.includesEdge("a", "d")).toBe(false);
  expect(focus.includesEdge("c", "e")).toBe(true);
  expect(dependencyFocus(edges, "unknown").ancestors.size).toBe(0);
});
it("keeps cards separate and reserves waypoints for a skip-level dependency", () => {
  const graph = {
    nodes,
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c" },
    ],
  };
  const result = dependencyLayout(graph, new Set(["b", "c", "d"]));
  for (const a of result.nodes)
    for (const b of result.nodes) {
      if (a.id === b.id) continue;
      expect(a.x + 236 <= b.x || b.x + 236 <= a.x || a.y + 120 <= b.y || b.y + 120 <= a.y).toBe(
        true,
      );
    }
  const skip = result.edges.find((edge) => edge.from === "a" && edge.to === "c")!;
  const middle = result.nodes.find((node) => node.id === "b")!;
  expect(
    skip.points.some(
      (point) =>
        point.x >= middle.x &&
        point.x <= middle.x + 236 &&
        (point.y < middle.y || point.y > middle.y + 120),
    ),
  ).toBe(true);
  const reversed = dependencyLayout(
    { nodes: [...nodes].reverse(), edges: [...graph.edges].reverse() },
    new Set(["b", "c", "d"]),
  );
  for (const node of result.nodes)
    expect(reversed.nodes.find((other) => other.id === node.id)).toEqual(node);
});
