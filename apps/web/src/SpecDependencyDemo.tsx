import { Play } from "lucide-react";
import { Dropdown } from "./Dropdown";
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
const lanes = [
  ["确定关联语义", "建立关联表", "实现关联写入", "接入网页操作", "验证并发请求", "验收关联行为"],
  [
    "确认可见性规则",
    "实现权限查询",
    "校验关联两端",
    "接入私有团队过滤",
    "验证权限变化",
    "验收访问边界",
  ],
  [
    "定义接口契约",
    "实现双向查询",
    "注册 MCP 工具",
    "接入 Agent 调用",
    "验证重试行为",
    "验收 MCP 集成",
  ],
  [
    "定义进度口径",
    "实现计数查询",
    "增加查询索引",
    "接入进度展示",
    "验证分页与计数",
    "验收进度统计",
  ],
  ["整理历史数据", "制定数据迁移", "编写迁移脚本", "准备灰度数据", "验证回退路径", "发布前检查"],
];
const nodeId = (lane: number, stage: number) =>
  "D-" + String(lane * 6 + stage + 1).padStart(2, "0");
const nodes: Node[] = lanes.flatMap((titles, lane) =>
  titles.map((title, stage) => ({
    id: nodeId(lane, stage),
    title,
    status: (stage === 0
      ? "done"
      : stage === 1
        ? lane === 1
          ? "backlog"
          : "in_progress"
        : "todo") as Status,
    x: 28 + stage * 292,
    y: 36 + lane * 156,
    owner: ["Chen", "Lin", "Agent"][lane % 3],
    description: `“${title}”属于示例实施路线 ${lane + 1}，用于观察多任务的先后关系。完成后可推进右侧后续工作。`,
  })),
);
const edges: string[][] = lanes.flatMap((_, lane) =>
  Array.from({ length: 5 }, (_, stage) => [nodeId(lane, stage), nodeId(lane, stage + 1)]),
);
edges.push(
  [nodeId(0, 1), nodeId(2, 2)],
  [nodeId(1, 2), nodeId(0, 3)],
  [nodeId(3, 4), nodeId(4, 5)],
  [nodeId(2, 4), nodeId(4, 5)],
);
const width = 1756,
  height = 820;
export function SpecDependencyDemo({ scope }: { scope: IssueScope }) {
  const [zoom, setZoom] = useState("0.75");
  const scale = Number(zoom);
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
        <span>依赖图 · 30 个示例任务 · {shown.size} 个可见</span>
        <Dropdown
          aria-label="Graph zoom"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: "0.5", label: "50%" },
            { value: "0.75", label: "75%" },
            { value: "1", label: "100%" },
          ]}
        />
        <span>箭头指向后续任务 · 淡色为范围外的前置任务</span>
      </div>
      <div className="dependency-scroll">
        <div style={{ width: width * scale, height: height * scale }}>
          <div
            className="dependency-canvas"
            style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
          >
            <svg className="dependency-edges" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
              {edges
                .filter(([a, b]) => shown.has(a) && shown.has(b))
                .map(([a, b]) => {
                  const from = nodes.find((n) => n.id === a)!,
                    to = nodes.find((n) => n.id === b)!;
                  const x = from.x + 236,
                    y = from.y + 50;
                  return (
                    <g key={a + b} className={selected === a || selected === b ? "highlight" : ""}>
                      <path
                        d={`M${x},${y} C${x + 28},${y} ${to.x - 28},${to.y + 50} ${to.x - 9},${to.y + 50}`}
                      />
                      <Play
                        x={to.x - 16}
                        y={to.y + 44}
                        width={12}
                        height={12}
                        fill="currentColor"
                        strokeWidth={0}
                      />
                    </g>
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
