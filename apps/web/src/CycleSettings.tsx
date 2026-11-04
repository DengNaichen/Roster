import { FormEvent, useState } from "react";
import { api, apiPath, RequestError } from "./shared";
import { CyclePage, CycleSettings, emptyCycles } from "./Cycles";
import { useRequestScope } from "./useRequestScope";
import { useResource } from "./useResource";
import "./cycles.css";

/** Cycles run Monday to Monday, so any chosen day snaps back to its Monday. */
export function mondayOf(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return date;
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

function today(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function CycleSettingsSection({ team, canManage }: { team: string; canManage: boolean }) {
  const resource = useResource<CyclePage>(
    apiPath(`/teams/${encodeURIComponent(team)}/cycles`),
    emptyCycles,
  );
  return (
    <section className="cycle-settings" aria-label={`${team} cycles`}>
      <h3>Cycles</h3>
      {resource.error ? (
        <>
          <RequestError message={resource.error} />
          <button className="button" onClick={() => void resource.reload()}>
            Retry cycles
          </button>
        </>
      ) : resource.loading ? (
        <p className="empty">Loading…</p>
      ) : (
        <CycleSettingsForm
          team={team}
          settings={resource.data.settings}
          canManage={canManage}
          onSaved={(page) => resource.update(() => page)}
        />
      )}
    </section>
  );
}

function CycleSettingsForm({
  team,
  settings,
  canManage,
  onSaved,
}: {
  team: string;
  settings: CycleSettings;
  canManage: boolean;
  onSaved: (page: CyclePage) => void;
}) {
  const configured = !!settings.start_date;
  const timezone = configured
    ? settings.timezone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const initial = {
    ...settings,
    timezone,
    enabled: settings.enabled || !configured,
    start_date: configured ? settings.start_date : mondayOf(today(timezone)),
    duration_weeks: configured ? settings.duration_weeks : 1,
  };
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const requests = useRequestScope(team);
  const locked = settings.enabled;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const edit = (change: Partial<CycleSettings>) => {
    setDraft({ ...draft, ...change });
    setSaved(false);
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    await requests.write(
      team,
      () => api<CyclePage>(apiPath(`/teams/${encodeURIComponent(team)}/cycles`), "PUT", draft),
      (page) => {
        onSaved(page);
        setSaving(false);
        setSaved(true);
      },
      (cause) => {
        setError(cause.message);
        setSaving(false);
      },
    );
  }
  const off = saving || !canManage;
  return (
    <form onSubmit={save}>
      <div className="settings-field">
        <div>
          <label htmlFor={`cycles-enabled-${team}`}>Enable cycles</label>
          <p id={`cycles-enabled-hint-${team}`}>
            Plan work in repeating periods that start every Monday.
          </p>
        </div>
        <input
          id={`cycles-enabled-${team}`}
          aria-describedby={`cycles-enabled-hint-${team}`}
          type="checkbox"
          checked={draft.enabled}
          disabled={off}
          onChange={(e) => edit({ enabled: e.target.checked })}
        />
      </div>
      <div className="settings-field">
        <div>
          <label htmlFor={`cycles-start-${team}`}>First Monday</label>
          <p id={`cycles-start-hint-${team}`}>Cycles start at midnight in the team timezone.</p>
        </div>
        <div className="settings-name">
          <input
            id={`cycles-start-${team}`}
            aria-describedby={`cycles-start-hint-${team}`}
            type="date"
            value={draft.start_date}
            disabled={off || locked}
            required
            onChange={(e) => edit({ start_date: mondayOf(e.target.value) })}
          />
        </div>
      </div>
      <details className="cycle-advanced">
        <summary>Advanced</summary>
        <div className="settings-field">
          <label htmlFor={`cycles-timezone-${team}`}>Timezone</label>
          <div className="settings-name">
            <input
              id={`cycles-timezone-${team}`}
              value={draft.timezone}
              disabled={off || locked}
              required
              placeholder="Asia/Shanghai"
              onChange={(e) => edit({ timezone: e.target.value })}
            />
          </div>
        </div>
        <div className="settings-field">
          <label htmlFor={`cycles-weeks-${team}`}>Weeks per cycle</label>
          <div className="settings-name">
            <input
              id={`cycles-weeks-${team}`}
              type="number"
              min={1}
              max={8}
              value={draft.duration_weeks}
              disabled={off || locked}
              required
              onChange={(e) => edit({ duration_weeks: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="settings-field">
          <label htmlFor={`cycles-upcoming-${team}`}>Upcoming cycles</label>
          <div className="settings-name">
            <input
              id={`cycles-upcoming-${team}`}
              type="number"
              min={1}
              max={15}
              value={draft.upcoming_count}
              disabled={off}
              required
              onChange={(e) => edit({ upcoming_count: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="dialog-hint">
          Disable cycles before changing the schedule. Reducing upcoming cycles keeps existing
          plans.
        </p>
      </details>
      {settings.enabled && !draft.enabled && (
        <p className="dialog-hint">
          Saving will close the current cycle and remove upcoming cycles and their assignments.
          Completed history is preserved.
        </p>
      )}
      {error && <RequestError message={error} />}
      {canManage && (
        <footer>
          <span role="status">{saved ? "Changes saved." : dirty ? "Unsaved changes" : ""}</span>
          <button
            type="button"
            className="button"
            disabled={saving || !dirty}
            onClick={() => {
              setDraft(initial);
              setError("");
              setSaved(false);
            }}
          >
            Reset
          </button>
          <button className="button primary" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </footer>
      )}
    </form>
  );
}
