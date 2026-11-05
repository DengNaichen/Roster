import { Play } from "lucide-react";
import { Dropdown } from "./Dropdown";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { dependencyLayout, dependencyNodeSize, dependencyFocus } from "./dependencyLayout";

export function SpecDependencies({ id, visible }: { id: string; visible: string[] }) {
  const resource = useResource<SpecGraph | null>(
    apiPath(`/specs/${encodeURIComponent(id)}/dependencies`),
    null,
  );
  const [zoom, setZoom] = useState("0.5");
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1000, height: 600 });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewportSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [resource.data, visible.length]);
  const [selected, setSelected] = useState("");
  const layout = useMemo(() => {
    try {
      return dependencyLayout(resource.data ?? { nodes: [], edges: [] }, new Set(visible));
    } catch {
      return null;
    }
  }, [resource.data, visible]);
  if (!layout)
    return <RequestError message="Unable to lay out dependencies. The graph contains a cycle." />;
  const { nodes, edges: relations, width, height } = layout;
  const scale =
    zoom === "fit"
      ? Math.max(
          0.1,
          Math.min(1, (viewportSize.width - 24) / width, (viewportSize.height - 24) / height),
        )
      : Number(zoom);
  const edges = relations.map((e) => [e.from, e.to]);
  const focused = new Set(
    nodes.filter((n) => !n.external && visible.includes(n.identifier)).map((n) => n.id),
  );
  const shown = new Set(nodes.map((n) => n.id));
  const current = nodes.find((n) => n.id === selected && shown.has(n.id));
  const focus = dependencyFocus(relations, current?.id ?? "");
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
    <div
      className="dependency-demo"
      onKeyDown={(event) => {
        if (event.key === "Escape") setSelected("");
      }}
    >
      <div className="dependency-caption">
        <span>依赖图 · {shown.size} 个可见任务</span>
        <Dropdown
          aria-label="Graph zoom"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: "fit", label: "适应画布" },
            { value: "0.35", label: "35%" },
            { value: "0.5", label: "50%" },
            { value: "0.75", label: "75%" },
            { value: "1", label: "100%" },
          ]}
        />
        <span>从左向右依赖 · 点击任务聚焦上下游 · 仅展示有权查看的关系</span>
      </div>
      <section className="dependency-selection" aria-label="Dependency focus">
        {current ? (
          <>
            <div className="dependency-selection-heading">
              <span className="spec-id">{current.identifier}</span>
              <h3>{current.title}</h3>
              <NavLink to={pagePath(`/issue/${current.identifier}`)}>打开任务</NavLink>
              <button className="button" onClick={() => setSelected("")}>
                取消聚焦
              </button>
            </div>
            <p aria-live="polite">
              上游 {focus.ancestors.size} 项 · 下游 {focus.descendants.size} 项
              {blockers(current.id).length
                ? ` · 等待 ${blockers(current.id)
                    .map((n) => n.identifier)
                    .join("、")}`
                : " · 无未完成的可见前置任务"}
            </p>
          </>
        ) : (
          <p>选择任务查看上游前置和下游影响；再次点击或按 Esc 取消聚焦。</p>
        )}
      </section>
      <div className="dependency-scroll" ref={viewport}>
        <div style={{ width: width * scale, height: height * scale }}>
          <div
            className="dependency-canvas"
            style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
          >
            <svg className="dependency-edges" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
              {relations.map(({ from, to, path, points }) => {
                const end = points[points.length - 1];
                return (
                  <g
                    key={from + to}
                    className={
                      current ? (focus.includesEdge(from, to) ? "highlight" : "is-dimmed") : ""
                    }
                  >
                    <path d={path} />
                    <Play
                      x={end.x - 10}
                      y={end.y - 6}
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
                  className={`card dependency-node ${focused.has(n.id) ? "" : "context"} ${current?.id === n.id ? "is-selected" : ""} ${current && !focus.nodes.has(n.id) ? "is-dimmed" : ""}`}
                  style={{ left: n.x, top: n.y, ...dependencyNodeSize }}
                  onClick={() => setSelected(selected === n.id ? "" : n.id)}
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
                    <span className="card-title" title={n.title}>
                      {n.title}
                    </span>
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
    </div>
  );
}
