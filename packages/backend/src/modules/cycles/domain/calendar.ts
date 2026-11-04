import { Temporal } from 'npm:@js-temporal/polyfill@0.5.1';
import type { CycleSettings } from '../../../../../contracts/cycles.ts';
import { fail } from '../../../platform/errors/validation.ts';
export const defaults: CycleSettings = {
  enabled: false,
  timezone: 'UTC',
  start_date: '',
  duration_weeks: 1,
  upcoming_count: 2,
};
export function startDate(cfg: CycleSettings) {
  try {
    if (cfg.timezone === 'Local' || /^[+-]/.test(cfg.timezone)) throw new Error();
    return Temporal.PlainDate.from(cfg.start_date, { overflow: 'reject' }).toZonedDateTime({
      timeZone: cfg.timezone,
      plainTime: '00:00',
    });
  } catch {
    return fail('invalid_input', 'Invalid cycle date or timezone');
  }
}
export function cycleBoundary(date: string, timezone: string, weeks: number) {
  const start = startDate({ ...defaults, start_date: date, timezone });
  return {
    starts_at: start.toInstant().toString({ smallestUnit: 'millisecond' }),
    ends_at: start.add({ weeks }).toInstant().toString({ smallestUnit: 'millisecond' }),
  };
}
export function mondayOf(date: Temporal.PlainDate) {
  return date.subtract({ days: date.dayOfWeek - 1 });
}
export function initialSettings(now: Date, timezone = defaults.timezone): CycleSettings {
  const today = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timezone).toPlainDate();
  return { ...defaults, enabled: true, timezone, start_date: mondayOf(today).toString() };
}
