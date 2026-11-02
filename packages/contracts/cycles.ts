import { z } from 'zod';
export type CycleSettings = {
  enabled: boolean;
  timezone: string;
  start_date: string;
  duration_weeks: number;
  upcoming_count: number;
};
export type Cycle = {
  id: number;
  team: string;
  number: number;
  name: string;
  description: string;
  timezone: string;
  starts_at: string;
  ends_at: string;
  completed_at: string | null;
  state: 'upcoming' | 'current' | 'completed';
  total: number;
  done: number;
  canceled: number;
  rolled_over: number;
};
export type CyclePage = { settings: CycleSettings; cycles: Cycle[] };
export const configureCyclesSchema = z.strictObject({
  enabled: z.boolean(),
  timezone: z.string().min(1).max(100),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration_weeks: z.number().int().min(1).max(8),
  upcoming_count: z.number().int().min(1).max(15),
});
export const updateCycleSchema = z.strictObject({
  name: z.string().trim().max(500).optional(),
  description: z.string().max(100000).optional(),
});
