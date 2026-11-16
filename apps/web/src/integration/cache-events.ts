export const writeStarted = "roster-write-started";
export const writeFinished = "roster-write-finished";
export type WriteEvent = { path: string; id: symbol; error?: unknown };
