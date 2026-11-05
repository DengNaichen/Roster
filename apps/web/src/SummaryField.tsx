export function SummaryField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="composer-description">
      <span className="composer-field-label">Summary</span>
      <textarea
        rows={3}
        maxLength={2000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="What changes for whom once this is done…"
        disabled={disabled}
      />
    </label>
  );
}
