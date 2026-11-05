import type { SpecDependencies } from "../../../packages/contracts/spec";
export function dependencyLayout(graph: SpecDependencies, visible: Set<string>) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const parents = new Map<string, string[]>(),
    children = new Map<string, string[]>();
  for (const { from, to } of graph.edges) {
    if (!byId.has(from) || !byId.has(to)) continue;
    parents.set(to, [...(parents.get(to) ?? []), from]);
    children.set(from, [...(children.get(from) ?? []), to]);
  }
  const shown = new Set(
    graph.nodes.filter((n) => !n.external && visible.has(n.identifier)).map((n) => n.id),
  );
  const pending = [...shown];
  for (let i = 0; i < pending.length; i++)
    for (const parent of parents.get(pending[i]) ?? [])
      if (!shown.has(parent)) {
        shown.add(parent);
        pending.push(parent);
      }
  const degree = new Map(
    [...shown].map((id) => [id, (parents.get(id) ?? []).filter((p) => shown.has(p)).length]),
  );
  const queue = [...shown].filter((id) => degree.get(id) === 0);
  const ranks = new Map<string, number>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i],
      rank = ranks.get(id) ?? 0;
    for (const child of children.get(id) ?? []) {
      if (!shown.has(child)) continue;
      ranks.set(child, Math.max(ranks.get(child) ?? 0, rank + 1));
      degree.set(child, degree.get(child)! - 1);
      if (degree.get(child) === 0) queue.push(child);
    }
  }
  if (queue.length !== shown.size) throw new Error("The dependency graph contains a cycle.");
  const rows = new Map<number, number>();
  let independent = 0;
  const connected = queue.filter((id) => parents.has(id) || children.has(id));
  const nodes = queue.map((id) => {
    const node = byId.get(id)!;
    let column = ranks.get(id) ?? 0,
      row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    if (connected.length === 0) {
      column = independent % 4;
      row = Math.floor(independent / 4);
      independent++;
    }
    return { ...node, x: 28 + column * 292, y: 36 + row * 156 };
  });
  return {
    nodes,
    edges: graph.edges.filter((e) => shown.has(e.from) && shown.has(e.to)),
    width: Math.max(600, ...nodes.map((n) => n.x + 264)),
    height: Math.max(280, ...nodes.map((n) => n.y + 144)),
  };
}
