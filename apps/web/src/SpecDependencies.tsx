import { Play } from "lucide-react";
import { Dropdown } from "./Dropdown";
import { useState } from "react";
import {
  columns,
  apiPath,
  RequestError,
  NavLink,
  pagePath,
  AssigneeBadge,
  StatusIcon,
} from "./shared";
import "./spec-dependencies.css";
import type { SpecDependencies as SpecGraph } from "../../../packages/contracts/spec";
import { useResource } from "./useResource";
import { dependencyLayout } from "./dependencyLayout";

export function SpecDependencies({ id, visible }: { id: string; visible: string[] }) {
  const resource = useResource<SpecGraph | null>(
    apiPath(`/specs/${encodeURIComponent(id)}/dependencies`),
    null,
  );
  const [zoom, setZoom] = useState("0.75");
  const scale = Number(zoom);
  const [selected, setSelected] = useState("");
  let layout: ReturnType<typeof dependencyLayout>;
  try {
    layout = dependencyLayout(resource.data ?? { nodes: [], edges: [] }, new Set(visible));
  } catch {
    return <RequestError message="Unable to lay out dependencies. The graph contains a cycle." />;
  }
  const { nodes, edges: relations, width, height } = layout;
  const edges = relations.map((e) => [e.from, e.to]);
  const focused = new Set(
    nodes.filter((n) => !n.external && visible.includes(n.identifier)).map((n) => n.id),
  );
  const shown = new Set(nodes.map((n) => n.id));
  const current = nodes.find((n) => n.id === selected && shown.has(n.id));
  const blockers = (id: string) =>
    edges
      .filter(([, to]) => to === id)
      .map(([from]) => nodes.find((n) => n.id === from)!)
      .filter((n) => n.status !== "done");
  if (resource.error)
    return (
      <div className="scope-message">
        <RequestError message={resource.error} />
        <button className="button" onClick={() => void resource.reload()}>
          Retry dependencies
        </button>
      </div>
    );
  if (!resource.data) return <p className="empty">Loading dependencies…</p>;
  if (!nodes.length) return <p className="empty">No linked issues match these filters.</p>;
  return (
    <div className="dependency-demo">
      <div className="dependency-caption">
        <span>依赖图 · {shown.size} 个可见任务</span>
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
        <span>箭头指向后续任务 · 淡色为范围外的前置任务 · 仅展示有权查看的关系</span>
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
                  <span className="card-identifier">
                    {n.identifier}
                    {n.external ? " · 外部依赖" : ""}
                  </span>
                  <span className="card-heading">
                    <span title={columns.find((c) => c.status === n.status)?.label}>
                      <StatusIcon status={n.status} />
                    </span>
                    <span className="card-title">{n.title}</span>
                  </span>
                  <span className="dependency-node-meta">
                    <AssigneeBadge person={n.assignee} />
                    <span>
                      {n.status === "done"
                        ? "已完成"
                        : blockers(n.id).length
                          ? `等待 ${blockers(n.id).length} 项`
                          : "无可见阻塞"}
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
            <span className="spec-id">{current.identifier}</span>
            <h3>{current.title}</h3>
          </div>
          <NavLink to={pagePath(`/issue/${current.identifier}`)}>打开任务详情</NavLink>
          <p className="dependency-caption">
            {blockers(current.id).length
              ? "尚未完成的前置任务 · " +
                blockers(current.id)
                  .map((n) => n.identifier + " " + n.title)
                  .join("、")
              : "没有尚未完成的可见前置任务"}
          </p>
        </section>
      )}
    </div>
  );
}
