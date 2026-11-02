import { UserRound } from "lucide-react";
import { Dropdown } from "./Dropdown";
import { apiPath, Identity, personName, RequestError } from "./shared";
import { useResource } from "./useResource";

type Candidates = { assignees: Identity[] };
type Members = { members: (Identity & { status: string })[] };

export function AssigneeSelect({
  team,
  value,
  current = null,
  onChange,
  disabled,
  label,
}: {
  team: string;
  value: string;
  current?: Identity | null;
  onChange: (value: string) => void;
  disabled: boolean;
  label: string;
}) {
  const { data, loading, error, reload } = useResource<Candidates>(
    team ? apiPath(`/teams/${encodeURIComponent(team)}/assignees`) : null,
    { assignees: [] },
  );
  const unavailable = value && !data.assignees.some((person) => person.subject === value);
  const person = data.assignees.find((candidate) => candidate.subject === value) ?? current;
  return (
    <span className={`assignee-control${value ? "" : " assignee-empty"}`}>
      {person ? (
        <span className="person-avatar" aria-hidden="true">
          {Array.from(personName(person))[0].toUpperCase()}
        </span>
      ) : (
        <UserRound className="icon" />
      )}
      <Dropdown
        variant="ghost"
        aria-label={label}
        value={value}
        disabled={disabled || loading || !team || !!error}
        onChange={(next) => onChange(next)}
        options={[
          { value: "", label: loading ? "Loading people…" : "Unassigned" },
          ...(unavailable
            ? [
                {
                  value,
                  label: `${current ? personName(current) : value} (unavailable)`,
                  disabled: true,
                },
              ]
            : []),
          ...data.assignees.map((candidate) => ({
            value: candidate.subject,
            label: personName(candidate),
          })),
        ]}
      />
      {error && (
        <>
          <RequestError message={error} />
          <button type="button" className="ghost" onClick={() => void reload()}>
            Retry people
          </button>
        </>
      )}
    </span>
  );
}

export function AssigneeFilter({
  value,
  currentLabel,
  onChange,
  enabled,
}: {
  value: string;
  currentLabel: string;
  onChange: (value: string, label: string) => void;
  enabled: boolean;
}) {
  const { data, loading, error, reload } = useResource<Members>(
    enabled ? apiPath("/members") : null,
    { members: [] },
  );
  return (
    <>
      <label className="toolbar-field">
        Assignee
        <Dropdown
          variant="block"
          aria-label="Filter by assignee"
          value={value}
          onChange={(next, option) => onChange(next, option.label)}
          options={[
            { value: "", label: "All assignees" },
            { value: "unassigned", label: "Unassigned" },
            ...(enabled ? [{ value: "me", label: "Assigned to me" }] : []),
            ...(value.startsWith("user:") &&
            !data.members.some((person) => `user:${person.subject}` === value)
              ? [{ value, label: currentLabel, disabled: true }]
              : []),
            ...data.members.map((person) => ({
              value: `user:${person.subject}`,
              label: `${personName(person)}${person.status === "suspended" ? " (suspended)" : ""}`,
            })),
          ]}
        />
      </label>
      {loading && <p>Loading people…</p>}
      {error && (
        <>
          <RequestError message={error} />
          <button type="button" className="ghost" onClick={() => void reload()}>
            Retry people
          </button>
        </>
      )}
    </>
  );
}
