import type { Row } from '../../../application/records.ts';
export interface CyclesRepository {
  settings(input: { id: unknown }): Promise<Row[]>;
  pendingCycles(
    input: {
      teamId: unknown;
      roll: boolean;
      now: Date;
    },
  ): Promise<Row[]>;
  issueCounts(input: { cycleId: unknown }): Promise<Row>;
  completeCycle(
    input: {
      end: string;
      total: unknown;
      done: unknown;
      canceled: unknown;
      moving: unknown;
      cycleId: unknown;
    },
  ): Promise<void>;
  nextCycle(input: { teamId: unknown; ends_at: unknown }): Promise<Row>;
  cycleTail(input: { teamId: unknown }): Promise<Row>;
  futureCount(input: { teamId: unknown; now: Date }): Promise<Row>;
  insertCycle(
    input: {
      workspace_id: unknown;
      teamId: unknown;
      number: number;
      timezone: string;
      startsAt: unknown;
      endsAt: unknown;
    },
  ): Promise<void>;
  cyclePage(input: { teamId: unknown }): Promise<Row[]>;
  resolveTeam(input: { id: number; workspaceId: unknown; subject: string }): Promise<Row>;
  overlappingCycles(input: { teamId: unknown; startsAt: unknown }): Promise<Row[]>;
  deletePendingCycles(input: { teamId: unknown }): Promise<void>;
  saveSettings(
    input: {
      teamId: unknown;
      enabled: boolean;
      timezone: string;
      start_date: string;
      duration_weeks: number;
      upcoming_count: number;
    },
  ): Promise<void>;
  insertSettingsIfMissing(
    input: {
      teamId: unknown;
      enabled: boolean;
      timezone: string;
      start_date: string;
      duration_weeks: number;
      upcoming_count: number;
    },
  ): Promise<void>;
  findCycle(input: { id: number }): Promise<Row>;
  updateCycle(input: { name: unknown; description: unknown; id: number }): Promise<void>;
  issueCycle(cycleId: { cycleId: number; teamId: unknown }): Promise<Row>;
  enabledTeams(): Promise<Row[]>;
}
