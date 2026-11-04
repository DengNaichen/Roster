import { useEffect, useState } from "react";

const renderer = import("mermaid").then(({ default: mermaid }) => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    suppressErrorRendering: true,
  });
  return mermaid;
});

export default function DesignDiagram({ source }: { source: string }) {
  const [result, setResult] = useState({ image: "", error: "" });
  useEffect(() => {
    let active = true;
    async function draw() {
      try {
        const mermaid = await renderer;
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
  }, [source]);
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
