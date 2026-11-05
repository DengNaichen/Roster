import { useState } from "react";
import {
  columns,
  issueScopes,
  AssigneeBadge,
  StatusIcon,
  type IssueScope,
  type Status,
} from "./shared";
import "./spec-dependencies.css";

type Node = {
  id: string;
  title: string;
  status: Status;
  x: number;
  y: number;
  owner: string;
  description: string;
};
const nodes: Node[] = [
  {
    id: "D-01",
    title: "定义关联数据模型",
    status: "done",
    x: 28,
    y: 190,
    owner: "Chen",
    description: "确定唯一约束、双向查询和解除关联的语义。",
  },
  {
    id: "D-02",
    title: "实现关联读写接口",
    status: "in_progress",
    x: 300,
    y: 90,
    owner: "Agent",
    description: "提供建立、查询和解除关联的公共入口。完成后网页和 MCP 可以并行接入。",
  },
  {
    id: "D-03",
    title: "确认私有团队权限",
    status: "backlog",
    x: 300,
    y: 290,
    owner: "Lin",
    description: "确认关联两端的可见性以及计数规则。这项工作尚未安排，会阻塞最终验收。",
  },
  {
    id: "D-04",
    title: "接入 Spec 关联列表",
    status: "todo",
    x: 572,
    y: 50,
    owner: "Chen",
    description: "展示关联任务，并支持从列表打开详情。等待接口完成。",
  },
  {
    id: "D-05",
    title: "接入 MCP 关联工具",
    status: "todo",
    x: 572,
    y: 220,
    owner: "Agent",
    description: "让 Agent 通过同一业务规则读写关联。可以与网页接入并行进行。",
  },
  {
    id: "D-06",
    title: "联调与验收",
    status: "todo",
    x: 844,
    y: 190,
    owner: "Lin",
    description: "覆盖重复请求、权限变化和双向读取。三个前置任务完成后开始。",
  },
];
const edges = [
  ["D-01", "D-02"],
  ["D-01", "D-03"],
  ["D-02", "D-04"],
  ["D-02", "D-05"],
  ["D-03", "D-06"],
  ["D-04", "D-06"],
  ["D-05", "D-06"],
];
export function SpecDependencyDemo({ scope }: { scope: IssueScope }) {
  const [selected, setSelected] = useState("D-02");
  const statuses = issueScopes.find((s) => s.value === scope)?.statuses;
  const focused = new Set(
    nodes.filter((n) => !statuses || statuses.includes(n.status)).map((n) => n.id),
  );
  const shown = new Set(focused);
  // Keep every prerequisite needed to explain the selected scope.
  for (let i = 0; i < nodes.length; i++)
    for (const [from, to] of edges) if (shown.has(to)) shown.add(from);
  const current = nodes.find((n) => n.id === selected && shown.has(n.id));
  const blockers = (id: string) =>
    edges
      .filter(([, to]) => to === id)
      .map(([from]) => nodes.find((n) => n.id === from)!)
      .filter((n) => n.status !== "done");
  return (
    <div className="dependency-demo">
      <div className="dependency-caption">
        <span>依赖图 · 示例数据</span>
        <span>箭头指向后续任务 · 淡色为范围外的前置任务</span>
      </div>
      <div className="dependency-scroll">
        <div className="dependency-canvas">
          <svg className="dependency-edges" viewBox="0 0 1120 460" aria-hidden="true">
            <defs>
              <marker
                id="dependency-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="currentColor" />
              </marker>
            </defs>
            {edges
              .filter(([a, b]) => shown.has(a) && shown.has(b))
              .map(([a, b]) => {
                const from = nodes.find((n) => n.id === a)!,
                  to = nodes.find((n) => n.id === b)!;
                const x = from.x + 236,
                  y = from.y + 50;
                return (
                  <path
                    key={a + b}
                    className={selected === a || selected === b ? "highlight" : ""}
                    d={`M${x},${y} C${x + 18},${y} ${to.x - 18},${to.y + 50} ${to.x - 3},${to.y + 50}`}
                    markerEnd="url(#dependency-arrow)"
                  />
                );
              })}
          </svg>
          {nodes
            .filter((n) => shown.has(n.id))
            .map((n) => (
              <button
                key={n.id}
                className={`card dependency-node ${focused.has(n.id) ? "" : "context"} ${selected === n.id ? "is-selected" : ""}`}
                style={{ left: n.x, top: n.y }}
                onClick={() => setSelected(n.id)}
                aria-pressed={selected === n.id}
              >
                <span className="card-identifier">{n.id}</span>
                <span className="card-heading">
                  <span title={columns.find((c) => c.status === n.status)?.label}>
                    <StatusIcon status={n.status} />
                  </span>
                  <span className="card-title">{n.title}</span>
                </span>
                <span className="dependency-node-meta">
                  <AssigneeBadge person={{ subject: n.owner, name: n.owner, email: "" }} />
                  <span>
                    {n.status === "done"
                      ? "已完成"
                      : blockers(n.id).length
                        ? `等待 ${blockers(n.id).length} 项`
                        : "前置已就绪"}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </div>
      {current && (
        <section className="dependency-selection">
          <div>
            <span className="spec-id">{current.id}</span>
            <h3>{current.title}</h3>
          </div>
          <p>{current.description}</p>
          <p className="dependency-caption">
            {blockers(current.id).length
              ? "尚未完成的前置任务 · " +
                blockers(current.id)
                  .map((n) => n.id + " " + n.title)
                  .join("、")
              : "所有前置任务已完成"}
          </p>
        </section>
      )}
    </div>
  );
}
