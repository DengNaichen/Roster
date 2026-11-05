import { useEffect, useState, useSyncExternalStore } from "react";
import { isDarkAppearance, resolveColorTokens, subscribeAppearance } from "./appearance";

const renderer = import("mermaid");

// Mermaid draws each sequence participant twice. Match both boxes by name.
function tintNodes(svg: string, colors: string[], surface: string) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const participants = new Map<string, string>();
  const nodes = document.querySelectorAll<SVGElement>(
    "rect.actor[name], g.statediagram-state > rect.label-container",
  );
  for (const node of nodes) {
    const id = node.getAttribute("name") ?? node.parentElement?.id;
    if (!id) continue;
    const color = participants.get(id) ?? colors[participants.size % colors.length];
    participants.set(id, color);
    if (!node.style.fill) node.style.fill = `color-mix(in srgb, ${color} 17%, ${surface})`;
    if (!node.style.stroke) node.style.stroke = color;
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}

export default function DesignDiagram({ source }: { source: string }) {
  const dark = useSyncExternalStore(subscribeAppearance, isDarkAppearance);
  const [result, setResult] = useState({ image: "", error: "" });
  useEffect(() => {
    let active = true;
    async function draw() {
      try {
        const { default: mermaid } = await renderer;
        if (!active) return;
        const names = [
          "--text",
          "--surface-card",
          "--raised",
          "--text-3",
          "--link",
          "--accent",
          "--success",
          "--pr-merged",
        ];
        const resolved = resolveColorTokens(names);
        const token = (name: string) => resolved[names.indexOf(name)];
        const text = token("--text"),
          surface = token("--surface-card"),
          node = token("--raised"),
          line = token("--text-3");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "base",
          themeVariables: {
            darkMode: dark,
            background: surface,
            primaryColor: node,
            primaryTextColor: text,
            primaryBorderColor: line,
            lineColor: line,
            textColor: text,
            actorBkg: node,
            actorTextColor: text,
            actorBorder: line,
            actorLineColor: line,
            signalColor: token("--link"),
            signalTextColor: text,
            labelBoxBkgColor: node,
            labelBoxBorderColor: line,
            labelTextColor: text,
            loopTextColor: text,
            edgeLabelBackground: surface,
            stateBkg: node,
            stateBorder: line,
            transitionColor: token("--link"),
            transitionLabelColor: text,
            stateLabelColor: text,
          },
        });
        if (!/^(sequenceDiagram|stateDiagram-v2)\b/.test(source.trim()) || source.includes("%%{"))
          throw new Error(
            "Use sequenceDiagram or stateDiagram-v2 without configuration directives.",
          );
        await mermaid.parse(source);
        const { svg } = await mermaid.render("design-" + crypto.randomUUID(), source);
        if (active)
          setResult({
            image:
              "data:image/svg+xml;charset=utf-8," +
              encodeURIComponent(
                tintNodes(
                  svg,
                  [token("--accent"), token("--success"), token("--pr-merged")],
                  surface,
                ),
              ),
            error: "",
          });
      } catch (error) {
        if (active)
          setResult({
            image: "",
            error: error instanceof Error ? error.message : "Unable to render diagram.",
          });
      }
    }
    void draw();
    return () => {
      active = false;
    };
  }, [source, dark]);
  if (result.error)
    return (
      <span role="alert" className="design-error">
        {result.error}
      </span>
    );
  return result.image ? (
    <img
      className="design-diagram"
      src={result.image}
      alt={source.trim().startsWith("sequence") ? "Sequence diagram" : "State diagram"}
    />
  ) : (
    <span>Rendering diagram…</span>
  );
}
