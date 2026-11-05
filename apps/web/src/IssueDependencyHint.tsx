import * as Popover from "@radix-ui/react-popover";
import type { SpecDependencies } from "../../../packages/contracts/spec";
import { AssigneeBadge, NavLink, pagePath, StatusIcon, columns } from "./shared";
import "./issue-dependencies.css";

type Node = SpecDependencies["nodes"][number];
export type IssueDependency = { before: Node[]; after: Node[] };

export function indexDependencies(graph: SpecDependencies) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const result = new Map<string, IssueDependency>();
  for (const node of graph.nodes) result.set(node.identifier, { before: [], after: [] });
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from),
      to = nodes.get(edge.to);
    if (!from || !to) continue;
    result.get(from.identifier)!.after.push(to);
    result.get(to.identifier)!.before.push(from);
  }
  return result;
}

export function IssueDependencyHint({
  identifier,
  status,
  relation,
}: {
  identifier: string;
  status: string;
  relation?: IssueDependency;
}) {
  if (!relation || (!relation.before.length && !relation.after.length)) return null;
  const blockers = relation.before.filter((node) => node.status !== "done");
  const blocked = status !== "done" && status !== "canceled" && blockers.length > 0;
  const label = blocked
    ? blockers.length === 1
      ? `被 ${blockers[0].identifier} 阻塞`
      : `被 ${blockers.length} 项阻塞`
    : relation.before.length
      ? blockers.length
        ? `前置 ${relation.before.length} 项`
        : "前置已完成"
      : `后续 ${relation.after.length} 项`;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`issue-dependency-hint ${blocked ? "is-blocked" : ""}`}
          aria-label={`${identifier} 依赖关系：${label}`}
        >
          {label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="toolbar-popover issue-dependency-popover"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={`${identifier} 依赖关系`}
        >
          <div className="toolbar-popover-heading">{identifier} · 依赖关系</div>
          {[
            { label: "前置任务", nodes: relation.before },
            { label: "后续任务", nodes: relation.after },
          ].map((group) => (
            <section key={group.label}>
              <h3>
                {group.label} <span>{group.nodes.length}</span>
              </h3>
              {!group.nodes.length && <p className="dependency-none">无可见{group.label}</p>}
              {group.nodes.map((node) => (
                <NavLink
                  key={node.id}
                  to={pagePath(`/issue/${node.identifier}`)}
                  className="dependency-related-issue"
                >
                  <span title={columns.find((column) => column.status === node.status)?.label}>
                    <StatusIcon status={node.status} />
                  </span>
                  <span className="dependency-related-content">
                    <span className="dependency-related-title">
                      <span className="identifier">{node.identifier}</span> {node.title}
                    </span>
                    <span className="dependency-related-meta">
                      <span>
                        {columns.find((column) => column.status === node.status)?.label}
                        {node.external ? " · Spec 外前置" : ""}
                      </span>
                      <AssigneeBadge person={node.assignee} />
                    </span>
                  </span>
                </NavLink>
              ))}
            </section>
          ))}
          <p className="dependency-none">后续仅统计当前 Spec；前置仅展示有权查看的任务。</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
