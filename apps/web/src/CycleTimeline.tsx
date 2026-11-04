import { CircleCheck, CircleDashed, CirclePlay } from "lucide-react";
import { NavLink, pagePath } from "./shared";
import { Cycle, cycleDates, cycleName, cyclePath, cycleStart, daysLeft, percent } from "./Cycles";

const stateIcon = { upcoming: CircleDashed, current: CirclePlay, completed: CircleCheck };

export function CycleTimeline({ cycles }: { cycles: Cycle[] }) {
  const ordered = [...cycles].sort((a, b) => b.number - a.number);
  return (
    <ol className="cycle-timeline">
      {ordered.map((cycle) => (
        <CycleRow key={cycle.id} cycle={cycle} />
      ))}
    </ol>
  );
}

function CycleRow({ cycle }: { cycle: Cycle }) {
  const Icon = stateIcon[cycle.state];
  return (
    <li className={`cycle-row ${cycle.state}`}>
      <time className="cycle-rail" dateTime={cycle.starts_at}>
        {cycleStart(cycle)}
      </time>
      <NavLink className="cycle-link" to={pagePath(cyclePath(cycle))}>
        <div className="cycle-summary">
          <Icon className="icon cycle-icon" aria-hidden="true" />
          <h2>{cycleName(cycle)}</h2>
          <span className="cycle-badge">{cycle.state}</span>
          <CycleMetrics cycle={cycle} />
        </div>
        {cycle.state === "current" && <CycleOverview cycle={cycle} />}
      </NavLink>
    </li>
  );
}

function CycleMetrics({ cycle }: { cycle: Cycle }) {
  const issues = (
    <span key="issues">{cycle.total === 1 ? "1 issue" : `${cycle.total} issues`}</span>
  );
  return (
    <span className="cycle-metrics">
      {cycle.state === "completed" ? (
        <>
          <span>{percent(cycle.done, cycle.total)}% success</span>
          <span>{cycle.done} completed</span>
          {cycle.rolled_over > 0 && <span>{cycle.rolled_over} carried over</span>}
          {issues}
        </>
      ) : (
        issues
      )}
    </span>
  );
}

function CycleOverview({ cycle }: { cycle: Cycle }) {
  const remaining = Math.max(0, cycle.total - cycle.done - cycle.canceled);
  const days = daysLeft(cycle);
  const rows = [
    { key: "done", label: "Completed", value: cycle.done, share: true },
    ...(cycle.canceled > 0
      ? [{ key: "canceled", label: "Canceled", value: cycle.canceled, share: true }]
      : []),
    { key: "remaining", label: "Remaining", value: remaining, share: true },
  ];
  const width = (value: number) => `${percent(value, cycle.total)}%`;
  return (
    <div className="cycle-overview-panel">
      <p className="cycle-range">
        {cycleDates(cycle)} · {days === 1 ? "1 day left" : `${days} days left`}
      </p>
      <div
        className="cycle-bar cycle-bar-large"
        role="progressbar"
        aria-label={`${cycleName(cycle)} completion`}
        aria-valuemin={0}
        aria-valuemax={Math.max(cycle.total, 1)}
        aria-valuenow={cycle.done}
      >
        <span className="done" style={{ width: width(cycle.done) }} />
        <span className="canceled" style={{ width: width(cycle.canceled) }} />
      </div>
      <dl className="cycle-legend">
        {rows.map((row) => (
          <div key={row.key} className={row.key}>
            <dt>{row.label}</dt>
            <dd>
              {row.value}
              {row.share && <small> · {percent(row.value, cycle.total)}%</small>}
            </dd>
          </div>
        ))}
      </dl>
      {cycle.description && <p className="cycle-description">{cycle.description}</p>}
    </div>
  );
}
