import { useId } from "react";

// Two identical cursors in one-point perspective: the far one is the near one
// scaled by 0.88 toward a vanishing point on their shared axis
// of symmetry, behind the tail, so the mark stays upright. Keep
// public/favicon.svg in sync when the geometry or colors change.
const near = "M7 7L95 41L59 59L41 95Z";
const far = "M24.28 24.28L101.72 54.2L70.04 70.04L54.2 101.72Z";

export function RosterLogo({ className }: { className?: string }) {
  const id = useId();
  const cursor = (d: string, fill: string, strokeWidth: number) => (
    <path d={d} fill={fill} stroke={fill} strokeWidth={strokeWidth} strokeLinejoin="round" />
  );
  return (
    <svg className={className} viewBox="0 0 108.72 108.72" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}near`} x2="1" y2="1">
          <stop style={{ stopColor: "var(--r-brand-near-start)" }} />
          <stop offset="1" style={{ stopColor: "var(--r-brand-near-end)" }} />
        </linearGradient>
        <linearGradient id={`${id}far`} x2="1" y2="1">
          <stop style={{ stopColor: "var(--r-brand-far-start)" }} />
          <stop offset="1" style={{ stopColor: "var(--r-brand-far-end)" }} />
        </linearGradient>
        <mask id={`${id}overlap`} maskUnits="userSpaceOnUse">
          {cursor(far, "#fff", 12.32)}
        </mask>
      </defs>
      {cursor(far, `url(#${id}far)`, 12.32)}
      {cursor(near, `url(#${id}near)`, 14)}
      <g mask={`url(#${id}overlap)`}>{cursor(near, "var(--r-brand-overlap)", 14)}</g>
    </svg>
  );
}
