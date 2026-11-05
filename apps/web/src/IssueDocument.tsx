import type {
  IssueBlock,
  IssueDocument as Document,
} from "../../../packages/contracts/issue-document";
import "./issue-document.css";

const number = (index: number) => String(index + 1).padStart(2, "0");

// Backticks mark inline code; everything else is plain text.
function Inline({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(`[^`]+`)/)
        .map((part, index) =>
          part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
            <code key={index}>{part.slice(1, -1)}</code>
          ) : (
            part
          ),
        )}
    </>
  );
}

function Items({ items }: { items: string[] }) {
  if (items.length === 1)
    return (
      <p>
        <Inline text={items[0]} />
      </p>
    );
  return (
    <ul>
      {items.map((item, index) => (
        <li key={index}>
          <Inline text={item} />
        </li>
      ))}
    </ul>
  );
}

function Block({ block }: { block: IssueBlock }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p>
          <Inline text={block.text} />
        </p>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List>
          {block.items.map((item, index) => (
            <li key={index}>
              {item.title && <strong>{item.title}</strong>}
              <Inline text={item.text} />
            </li>
          ))}
        </List>
      );
    }
    case "compare":
      return (
        <div className="issue-doc-columns">
          {[block.left, block.right].map((side, index) => (
            <div key={index} className={`issue-doc-panel${index === 0 ? " issue-doc-scope" : ""}`}>
              <h3>{side.title}</h3>
              <Items items={side.items} />
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <table>
          <thead>
            <tr>
              {block.columns.map((column, index) => (
                <th key={index} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "note":
      return (
        <aside className="issue-doc-note">
          {block.title && <h3>{block.title}</h3>}
          <p>
            <Inline text={block.text} />
          </p>
        </aside>
      );
    case "code":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
  }
}

export function IssueDocument({
  document,
  onCriterionChange,
}: {
  document: Document;
  onCriterionChange?: (criterion: string, done: boolean) => void;
}) {
  const { lead, sections, criteria } = document;
  if (!lead && !sections.length && !criteria.length) return null;
  const done = criteria.filter((criterion) => criterion.done).length;
  return (
    <article className="issue-document">
      {lead && (
        <p className="issue-doc-lead">
          <Inline text={lead} />
        </p>
      )}
      {sections.map((section, index) => (
        <section key={index}>
          <h2>
            {number(index)} · {section.title}
          </h2>
          {section.blocks.map((block, blockIndex) => (
            <Block key={blockIndex} block={block} />
          ))}
        </section>
      ))}
      {criteria.length > 0 && (
        <section aria-label="Acceptance criteria">
          <h2>
            {number(sections.length)} · Acceptance criteria{" "}
            <span className="issue-doc-progress">
              {done}/{criteria.length}
            </span>
          </h2>
          <ol className="issue-doc-criteria">
            {criteria.map((criterion) => (
              <li key={criterion.id} className={criterion.done ? "issue-doc-done" : undefined}>
                <input
                  type="checkbox"
                  className="issue-doc-check"
                  aria-label={criterion.title}
                  checked={criterion.done}
                  disabled={!onCriterionChange}
                  onChange={(event) => onCriterionChange?.(criterion.id, event.target.checked)}
                />
                <strong>{criterion.title}</strong>
                {criterion.detail && <Inline text={criterion.detail} />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
