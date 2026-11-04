import { FormEvent, useState } from "react";
import { Dropdown } from "./Dropdown";
import { api, apiPath, ModalDialog, RequestError } from "./shared";
import { useResource } from "./useResource";
import { useRequestScope } from "./useRequestScope";

export type CycleSettings = {
  enabled: boolean;
  timezone: string;
  start_date: string;
  duration_weeks: number;
  upcoming_count: number;
};
export type Cycle = {
  timezone: string;
  id: number;
  team: string;
  number: number;
  name: string;
  description: string;
  starts_at: string;
  ends_at: string;
  completed_at: string | null;
  state: "current" | "upcoming" | "completed";
  total: number;
  done: number;
  canceled: number;
  rolled_over: number;
};
export type CyclePage = { settings: CycleSettings; cycles: Cycle[] };
export const emptyCycles: CyclePage = {
  settings: {
    enabled: false,
    timezone: "UTC",
    start_date: "",
    duration_weeks: 1,
    upcoming_count: 2,
  },
  cycles: [],
};
export const cycleName = (cycle: Cycle) => cycle.name || `Cycle ${cycle.number}`;
export const cyclePath = (cycle: Cycle) =>
  `/team/${encodeURIComponent(cycle.team)}/cycles/${cycle.id}`;
export function cycleDates(cycle: Cycle) {
  const format = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      timeZone: cycle.timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${format(cycle.starts_at)} – ${format(new Date(new Date(cycle.ends_at).getTime() - 1).toISOString())}`;
}

export const cycleStart = (cycle: Cycle) =>
  new Date(cycle.starts_at).toLocaleDateString(undefined, {
    timeZone: cycle.timezone,
    month: "short",
    day: "numeric",
  });
export const percent = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;
export function daysLeft(cycle: Cycle, now = new Date()) {
  const remaining = new Date(cycle.ends_at).getTime() - now.getTime();
  return Math.max(0, Math.ceil(remaining / 86_400_000));
}

export function CycleSelect({
  team,
  value,
  onChange,
  disabled = false,
  label = "Cycle",
  filter = false,
}: {
  team: string;
  value: number | "";
  onChange: (id: number | "") => void;
  disabled?: boolean;
  label?: string;
  filter?: boolean;
}) {
  const resource = useResource<CyclePage>(
    team ? apiPath(`/teams/${encodeURIComponent(team)}/cycles`) : null,
    emptyCycles,
  );
  const available = resource.data.cycles.filter(
    (c) => filter || (resource.data.settings.enabled && c.state !== "completed") || c.id === value,
  );
  return (
    <span className="cycle-select">
      <Dropdown
        variant="ghost"
        aria-label={label}
        value={String(value)}
        disabled={disabled || !team || resource.loading || !!resource.error}
        onChange={(next) => onChange(next === "" ? "" : Number(next))}
        options={[
          ...(filter ? [{ value: "", label: "All cycles" }] : []),
          { value: "0", label: "No cycle" },
          ...(value !== "" && value !== 0 && !available.some((c) => c.id === value)
            ? [{ value: String(value), label: "Cycle unavailable", disabled: true }]
            : []),
          ...available.map((c) => ({ value: String(c.id), label: `${cycleName(c)} · ${c.state}` })),
        ]}
      />
      {resource.error && (
        <>
          <RequestError message={resource.error} />
          <button type="button" className="ghost" onClick={() => void resource.reload()}>
            Retry cycles
          </button>
        </>
      )}
    </span>
  );
}

export function CycleEditor({
  cycle,
  onClose,
  onSaved,
}: {
  cycle: Cycle;
  onClose: () => void;
  onSaved: (cycle: Cycle) => void;
}) {
  const [name, setName] = useState(cycle.name);
  const [description, setDescription] = useState(cycle.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requests = useRequestScope(String(cycle.id));
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await requests.write(
      "cycle",
      () => api<Cycle>(apiPath(`/cycles/${cycle.id}`), "PATCH", { name, description }),
      onSaved,
      (cause) => {
        setError(cause.message);
        setSaving(false);
      },
    );
  }
  return (
    <ModalDialog
      className="issue-dialog"
      aria-labelledby="edit-cycle-title"
      restoreFocus
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form onSubmit={save}>
        <header>
          <h2 id="edit-cycle-title">Edit cycle</h2>
        </header>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            placeholder={`Cycle ${cycle.number}`}
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
            rows={4}
          />
        </label>
        {error && <RequestError message={error} />}
        <footer>
          <button type="button" className="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={saving}>
            Save changes
          </button>
        </footer>
      </form>
    </ModalDialog>
  );
}
