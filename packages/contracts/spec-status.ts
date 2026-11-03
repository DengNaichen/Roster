/** Only these states can be chosen for a new revision. */
export const specStatuses = ['draft', 'review', 'active'] as const;
export type SpecStatus = typeof specStatuses[number];
/** Superseded revisions predate the three-state workflow and remain readable. */
export type SpecReadStatus = SpecStatus | 'superseded';
