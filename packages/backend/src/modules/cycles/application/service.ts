import { Temporal } from 'npm:@js-temporal/polyfill@0.5.1';
import {
  configureCyclesSchema,
  type CyclePage,
  type CycleSettings,
  updateCycleSchema,
} from '../../../../../contracts/cycles.ts';
import type { RequestContext } from '../../../../../contracts/mod.ts';
import type { CycleService } from '../../../application/cycles.ts';
import type { Row } from '../../../application/records.ts';
import type { Session, UnitOfWork } from '../../../application/session.ts';
import { lockWorkspace } from '../../access/index.ts';
import { clearPendingCycleIssues, rollCycleIssues } from '../../issues/index.ts';
import { defaults, startDate } from '../domain/calendar.ts';

import { fail } from '../../../platform/errors/validation.ts';
import { iso } from '../../../platform/time.ts';
import { manager, team, workspace } from '../../access/index.ts';
import { audit } from '../../audit/index.ts';
function parse<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) fail('invalid_input', 'Invalid cycle settings');
  return result.data!;
}
async function settings(db: Session, id: unknown): Promise<CycleSettings> {
  const r = (await db.cycles.settings({ id }))[0];
  return r ? r as unknown as CycleSettings : { ...defaults };
}
async function close(db: Session, t: Row, now: Date, roll: boolean) {
  const pending = await db.cycles.pendingCycles({
    teamId: t.id,
    roll,
    now,
  });
  for (const c of pending) {
    const counts = await db.cycles.issueCounts({ cycleId: c.id });
    const end = roll ? iso(c.ends_at) : now.toISOString();
    await db.cycles.completeCycle({
      end,
      total: counts.total,
      done: counts.done,
      canceled: counts.canceled,
      moving: roll ? counts.moving : 0,
      cycleId: c.id,
    });
    if (roll && Number(counts.moving) > 0) {
      const next = await db.cycles.nextCycle({ teamId: t.id, ends_at: c.ends_at });
      await rollCycleIssues(db, c.id, next.id, now);
    }
  }
}
export async function advanceTeamCycles(db: Session, t: Row, now: Date) {
  const cfg = await settings(db, t.id);
  if (!cfg.enabled) return;
  let start = startDate(cfg);
  const tail = await db.cycles.cycleTail({ teamId: t.id });
  let number = Number(tail.number);
  if (tail.last_end && new Date(iso(tail.last_end)).getTime() > Number(start.epochMilliseconds)) {
    start = Temporal.Instant.from(iso(tail.last_end)).toZonedDateTimeISO(cfg.timezone);
  }
  let future = Number(
    (await db.cycles.futureCount({ teamId: t.id, now })).n,
  );
  let generated = 0;
  while (Number(start.epochMilliseconds) <= now.getTime() || future < cfg.upcoming_count) {
    if (++generated > 5000) {
      fail('conflict', 'Cycle catch-up exceeds the 5000 interval safety limit');
    }
    const end = start.add({ weeks: cfg.duration_weeks });
    number++;
    await db.cycles.insertCycle({
      workspace_id: t.workspace_id,
      teamId: t.id,
      number,
      timezone: cfg.timezone,
      startsAt: start.toInstant().toString(),
      endsAt: end.toInstant().toString(),
    });
    if (Number(start.epochMilliseconds) > now.getTime()) future++;
    start = end;
  }
  await close(db, t, now, true);
}
async function page(db: Session, t: Row, now: Date): Promise<CyclePage> {
  const cfg = await settings(db, t.id);
  const result = await db.cycles.cyclePage({ teamId: t.id });
  return {
    settings: cfg,
    cycles: result.map((c) => ({
      id: Number(c.id),
      team: String(t.key),
      number: Number(c.number),
      name: String(c.name),
      description: String(c.description),
      timezone: String(c.timezone),
      starts_at: iso(c.starts_at),
      ends_at: iso(c.ends_at),
      completed_at: c.completed_at ? iso(c.completed_at) : null,
      state: c.completed_at
        ? 'completed'
        : new Date(iso(c.starts_at)) <= now
        ? 'current'
        : 'upcoming',
      total: Number(c.total),
      done: Number(c.done),
      canceled: Number(c.canceled),
      rolled_over: Number(c.rolled_over),
    })),
  };
}
export function createCycleService(
  db: UnitOfWork,
  options: { now?: () => Date } = {},
): CycleService {
  const now = options.now ?? (() => new Date());
  async function resolve(db: Session, ctx: RequestContext, w: Row, id: number) {
    if (!Number.isSafeInteger(id) || id < 1) fail('invalid_input', 'Invalid cycle id');
    const r = await db.cycles.resolveTeam({ id, workspaceId: w.id, subject: ctx.identity.subject });
    return team(db, ctx, w, String(r.key));
  }
  return {
    async listCycles(ctx, slug, key) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, key);
        const clock = now();
        await advanceTeamCycles(tx, t, clock);
        return page(tx, t, clock);
      });
    },
    async configureCycles(ctx, slug, key, input) {
      const cfg = parse(configureCyclesSchema, input);
      const start = startDate(cfg);
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, key);
        manager(t, w);
        const old = await settings(tx, t.id);
        const clock = now();
        if (
          old.enabled && cfg.enabled &&
          (old.timezone !== cfg.timezone || old.start_date !== cfg.start_date ||
            old.duration_weeks !== cfg.duration_weeks)
        ) fail('conflict', 'Disable cycles before changing the schedule');
        if (!old.enabled && cfg.enabled) {
          const today = Temporal.Instant.from(clock.toISOString()).toZonedDateTimeISO(cfg.timezone)
            .toPlainDate().toString();
          if (cfg.start_date < today) fail('invalid_input', 'A schedule must begin today or later');
          const overlap = await tx.cycles.overlappingCycles({
            teamId: t.id,
            startsAt: start.toInstant().toString(),
          });
          if (overlap.length) fail('conflict', 'Cycle schedules must not overlap');
        }
        if (old.enabled) await advanceTeamCycles(tx, t, clock);
        if (old.enabled && !cfg.enabled) {
          await close(tx, t, clock, false);
          await clearPendingCycleIssues(tx, t.id, clock);
          await tx.cycles.deletePendingCycles({ teamId: t.id });
        }
        await tx.cycles.saveSettings({
          teamId: t.id,
          enabled: cfg.enabled,
          timezone: cfg.timezone,
          start_date: cfg.start_date,
          duration_weeks: cfg.duration_weeks,
          upcoming_count: cfg.upcoming_count,
        });
        if (cfg.enabled) await advanceTeamCycles(tx, t, clock);
        await audit(tx, ctx, w, 'cycles.configured', old, cfg);
        return page(tx, t, clock);
      });
    },
    async getCycle(ctx, slug, id) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await resolve(tx, ctx, w, id);
        const clock = now();
        await advanceTeamCycles(tx, t, clock);
        const result = (await page(tx, t, clock)).cycles.find((c) => c.id === id);
        return result ?? fail('not_found', 'Cycle not found');
      });
    },
    async updateCycle(ctx, slug, id, input) {
      const value = parse(updateCycleSchema, input);
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await resolve(tx, ctx, w, id);
        const clock = now();
        await advanceTeamCycles(tx, t, clock);
        const before = await tx.cycles.findCycle({ id });
        await tx.cycles.updateCycle({
          name: value.name ?? before.name,
          description: value.description ?? before.description,
          id,
        });
        await audit(tx, ctx, w, 'cycle.updated', before, value);
        return (await page(tx, t, clock)).cycles.find((c) => c.id === id) ??
          fail('not_found', 'Cycle not found');
      });
    },
  };
}
export async function validateIssueCycle(
  db: Session,
  t: Row,
  input: number | undefined,
  current: number | null,
  now = new Date(),
): Promise<number | null> {
  if (input === undefined) return current;
  if (!Number.isSafeInteger(input) || input < 0) fail('invalid_input', 'Invalid cycle');
  if (input === 0) return null;
  if (input === current) return current;
  await advanceTeamCycles(db, t, now);
  const c = await db.cycles.issueCycle({ cycleId: input, teamId: t.id });
  if (!c.enabled || c.completed_at || new Date(iso(c.ends_at)) <= now) {
    fail('conflict', 'Cycle is closed or disabled');
  }
  return input;
}
/** Internal maintenance entrypoint; never expose as an authenticated end-user method. */
export async function advanceAllCycles(db: UnitOfWork, now = new Date()) {
  const teams = await db.cycles.enabledTeams();
  for (const t of teams) {
    await db.transaction(async (tx) => {
      await lockWorkspace(tx, t.workspace_id);
      await advanceTeamCycles(tx, t, now);
    });
  }
}
