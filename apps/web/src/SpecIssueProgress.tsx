import type { SpecIssueProgress as Progress } from "../../../packages/contracts/spec";
export function SpecIssueProgress({ progress }: { progress: Progress }) {
  if (!progress?.total) return null;
  const { done, total } = progress;
  const label = `${done} of ${total} linked issues completed`;
  return (
    <span className="work-count" role="img" aria-label={label} title={label}>
      <span
        aria-hidden="true"
        className="work-progress-ring"
        style={{
          backgroundImage: `conic-gradient(currentColor ${done / total}turn, transparent 0)`,
        }}
      />
      {done}/{total}
    </span>
  );
}
