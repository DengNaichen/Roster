import { useState } from "react";
import { IssueDocument } from "./IssueDocument";

const modes = [
  ["write", "Write"],
  ["preview", "Preview"],
] as const;
type Mode = (typeof modes)[number][0];

export function DescriptionField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [mode, setMode] = useState<Mode>("write");
  return (
    <div className="composer-description">
      <div className="segmented" role="tablist" aria-label="Description mode">
        {modes.map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {mode === "write" ? (
        <textarea
          aria-label="Description"
          rows={5}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Add a description… (HTML)"
          disabled={disabled}
        />
      ) : (
        <div className="composer-preview" role="tabpanel" aria-label="Description preview">
          {value.trim() ? (
            <IssueDocument text={value} />
          ) : (
            <p className="composer-preview-empty">Nothing to preview</p>
          )}
        </div>
      )}
    </div>
  );
}
