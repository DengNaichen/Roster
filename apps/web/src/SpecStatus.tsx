import { CircleCheck, CircleDashed, CircleDot, CircleMinus } from "lucide-react";
import { specStatuses, type SpecReadStatus } from "../../../packages/contracts/spec-status";
import "./spec-status.css";

const states = {
  draft: { label: "Draft", icon: CircleDashed },
  review: { label: "In review", icon: CircleDot },
  active: { label: "Active", icon: CircleCheck },
  superseded: { label: "Superseded", icon: CircleMinus },
} satisfies Record<SpecReadStatus, { label: string; icon: typeof CircleCheck }>;

function SpecStatusIcon({ status }: { status: SpecReadStatus }) {
  const Icon = states[status].icon;
  return <Icon className="spec-status-icon" data-spec-status={status} aria-hidden="true" />;
}

export function SpecStatusBadge({
  status,
  revision,
}: {
  status: SpecReadStatus;
  revision?: number;
}) {
  return (
    <span className="spec-status" data-spec-status={status}>
      <SpecStatusIcon status={status} />
      {revision !== undefined && `r${revision} · `}
      {states[status].label}
    </span>
  );
}

export const specStatusOptions = specStatuses.map((value) => ({
  value,
  label: states[value].label,
  icon: <SpecStatusIcon status={value} />,
}));
