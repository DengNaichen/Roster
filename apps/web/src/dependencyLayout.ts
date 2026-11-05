import { graphlib, layout as arrange } from "@dagrejs/dagre";
import type { SpecDependencies } from "../../../packages/contracts/spec";
export const dependencyNodeSize = { width: 236, height: 120 };

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
  const relations = graph.edges.filter((e) => shown.has(e.from) && shown.has(e.to));
  const connected = new Set(relations.flatMap((e) => [e.from, e.to]));
  const dag = new graphlib.Graph()
    .setGraph({
      rankdir: "LR",
      ranker: "network-simplex",
      nodesep: 24,
      edgesep: 12,
      ranksep: 40,
      marginx: 28,
      marginy: 36,
    })
    .setDefaultEdgeLabel(() => ({}));
  // Reserve space around cards for curves and horizontal arrow landings.
  for (const id of [...connected].sort())
    dag.setNode(id, {
      width: dependencyNodeSize.width + 40,
      height: dependencyNodeSize.height + 8,
    });
  for (const edge of [...relations].sort((a, b) =>
    `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`),
  ))
    dag.setEdge(edge.from, edge.to);
  if (connected.size) arrange(dag);
  const independentTop = connected.size ? (dag.graph().height ?? 0) + 40 : 36;
  let independent = 0;
  const nodes = queue.map((id) => {
    if (connected.has(id)) {
      const placed = dag.node(id);
      return {
        ...byId.get(id)!,
        x: placed.x - dependencyNodeSize.width / 2,
        y: placed.y - dependencyNodeSize.height / 2,
      };
    }
    const index = independent++;
    return {
      ...byId.get(id)!,
      x: 52 + (index % 4) * 284,
      y: independentTop + Math.floor(index / 4) * 156,
    };
  });
  const positioned = new Map(nodes.map((node) => [node.id, node]));
  const edges = relations.map((edge) => {
    const from = positioned.get(edge.from)!;
    const to = positioned.get(edge.to)!;
    const start = {
      x: from.x + dependencyNodeSize.width,
      y: from.y + dependencyNodeSize.height / 2,
    };
    const end = { x: to.x, y: to.y + dependencyNodeSize.height / 2 };
    const departure = { x: start.x + 18, y: start.y };
    const landing = { x: end.x - 18, y: end.y };
    const waypoints = dag
      .edge(edge.from, edge.to)
      .points.filter(
        (point: { x: number; y: number }) => point.x > departure.x && point.x < landing.x,
      );
    const points = [start, departure, ...waypoints, landing, end];
    let path = `M${start.x},${start.y} L${departure.x},${departure.y}`;
    const curve = [departure, ...waypoints, landing];
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1],
        b = curve[i],
        mid = (a.x + b.x) / 2;
      path += ` C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`;
    }
    path += ` L${end.x - 7},${end.y}`;
    return { ...edge, points, path };
  });
  return {
    nodes,
    edges,
    width: Math.max(600, ...nodes.map((n) => n.x + 264)),
    height: Math.max(280, ...nodes.map((n) => n.y + 156)),
  };
}

export function dependencyFocus(edges: SpecDependencies["edges"], selected: string) {
  const walk = (reverse: boolean) => {
    const found = new Set<string>();
    const pending = [selected];
    for (let i = 0; i < pending.length; i++) {
      for (const edge of edges) {
        const from = reverse ? edge.to : edge.from,
          to = reverse ? edge.from : edge.to;
        if (from !== pending[i] || to === selected || found.has(to)) continue;
        found.add(to);
        pending.push(to);
      }
    }
    return found;
  };
  const ancestors = walk(true),
    descendants = walk(false);
  const nodes = new Set([selected, ...ancestors, ...descendants]);
  const includesEdge = (from: string, to: string) =>
    ((ancestors.has(from) || from === selected) && (ancestors.has(to) || to === selected)) ||
    ((descendants.has(from) || from === selected) && (descendants.has(to) || to === selected));
  return { ancestors, descendants, nodes, includesEdge };
}
