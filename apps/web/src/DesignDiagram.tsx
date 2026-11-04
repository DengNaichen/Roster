import { useEffect, useState, useSyncExternalStore } from "react";

const renderer = import("mermaid");
const preference = "(prefers-color-scheme: dark)";
function subscribeTheme(update: () => void) {
  const media = window.matchMedia(preference);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
function isDark() {
  return window.matchMedia(preference).matches;
}

export default function DesignDiagram({ source }: { source: string }) {
  const dark = useSyncExternalStore(subscribeTheme, isDark);
  const [result, setResult] = useState({ image: "", error: "" });
  useEffect(() => {
    let active = true;
    async function draw() {
      try {
        const { default: mermaid } = await renderer;
        if (!active) return;
        const css = getComputedStyle(document.documentElement);
        const token = (name: string) => css.getPropertyValue(name).trim();
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
            signalColor: line,
            signalTextColor: text,
            labelBoxBkgColor: node,
            labelBoxBorderColor: line,
            labelTextColor: text,
            loopTextColor: text,
            edgeLabelBackground: surface,
            stateBkg: node,
            stateBorder: line,
            transitionColor: line,
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
            image: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
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
