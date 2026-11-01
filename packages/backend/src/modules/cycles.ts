import { Temporal } from 'npm:@js-temporal/polyfill@0.5.1';
import { sql } from 'npm:drizzle-orm@0.45.4';
import type { Database } from '../db/client.ts';
import {
  configureCyclesSchema,
  type Cycle,
  type CyclePage,
  type CycleService,
  type CycleSettings,
  updateCycleSchema,
} from '../../../contracts/cycles.ts';
import type { RequestContext } from '../../../contracts/mod.ts';
import {
  audit,
  type Executor,
  fail,
  iso,
  manager,
  one,
  type Row,
  rows,
  team,
  visible,
  workspace,
} from './shared.ts';
const defaults: CycleSettings = {
  enabled: false,
  timezone: 'UTC',
  start_date: '',
  duration_weeks: 2,
  upcoming_count: 2,
};
function parse<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) fail('invalid_input', 'Invalid cycle settings');
  return result.data!;
}
async function settings(db: Executor, id: unknown): Promise<CycleSettings> {
  const r = (await rows(
    db,
    sql`select enabled,timezone,to_char(start_date,'YYYY-MM-DD') as start_date,duration_weeks,upcoming_count from roster.team_cycle_settings where team_id=${id}`,
  ))[0];
  return r ? r as unknown as CycleSettings : { ...defaults };
}
function startDate(cfg: CycleSettings) {
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
async function close(db: Executor, t: Row, now: Date, roll: boolean) {
  const pending = await rows(
    db,
    sql`select * from roster.cycles where team_id=${t.id} and completed_at is null and ${
      roll ? sql`ends_at<=${now}` : sql`starts_at<${now}`
    } order by starts_at`,
  );
  for (const c of pending) {
    const counts = await one(
      db,
      sql`select count(*)::int as total,count(*) filter(where status='done')::int as done,count(*) filter(where status='canceled')::int as canceled,count(*) filter(where status in ('todo','agent_ready','in_progress','in_review'))::int as moving from roster.issues where cycle_id=${c.id}`,
    );
    const end = roll ? iso(c.ends_at) : now.toISOString();
    await db.execute(
      sql`update roster.cycles set completed_at=${end},ends_at=${end},total=${counts.total},done=${counts.done},canceled=${counts.canceled},rolled_over=${
        roll ? counts.moving : 0
      } where id=${c.id}`,
    );
    if (roll && Number(counts.moving) > 0) {
      const next = await one(
        db,
        sql`select id from roster.cycles where team_id=${t.id} and starts_at>=${c.ends_at} order by starts_at limit 1`,
      );
      await db.execute(
        sql`update roster.issues set cycle_id=${next.id},updated_at=${now} where cycle_id=${c.id} and status in ('todo','agent_ready','in_progress','in_review')`,
      );
    }
  }
}
export async function advanceTeamCycles(db: Executor, t: Row, now: Date) {
  const cfg = await settings(db, t.id);
  if (!cfg.enabled) return;
  let start = startDate(cfg);
  const tail = await one(
    db,
    sql`select max(ends_at) as last_end,coalesce(max(number),0)::int as number from roster.cycles where team_id=${t.id}`,
  );
  let number = Number(tail.number);
  if (tail.last_end && new Date(iso(tail.last_end)).getTime() > Number(start.epochMilliseconds)) {
    start = Temporal.Instant.from(iso(tail.last_end)).toZonedDateTimeISO(cfg.timezone);
  }
  let future = Number(
    (await one(
      db,
      sql`select count(*)::int as n from roster.cycles where team_id=${t.id} and completed_at is null and starts_at>${now}`,
    )).n,
  );
  let generated = 0;
  while (Number(start.epochMilliseconds) <= now.getTime() || future < cfg.upcoming_count) {
    if (++generated > 5000) {
      fail('conflict', 'Cycle catch-up exceeds the 5000 interval safety limit');
    }
    const end = start.add({ weeks: cfg.duration_weeks });
    number++;
    await db.execute(
      sql`insert into roster.cycles(workspace_id,team_id,number,timezone,starts_at,ends_at) values(${t.workspace_id},${t.id},${number},${cfg.timezone},${start.toInstant().toString()},${end.toInstant().toString()})`,
    );
    if (Number(start.epochMilliseconds) > now.getTime()) future++;
    start = end;
  }
  await close(db, t, now, true);
}
async function page(db: Executor, t: Row, now: Date): Promise<CyclePage> {
  const cfg = await settings(db, t.id);
  const result = await rows(
    db,
    sql`select c.*,case when c.completed_at is null then (select count(*)::int from roster.issues where cycle_id=c.id) else c.total end as total,case when c.completed_at is null then (select count(*)::int from roster.issues where cycle_id=c.id and status='done') else c.done end as done,case when c.completed_at is null then (select count(*)::int from roster.issues where cycle_id=c.id and status='canceled') else c.canceled end as canceled from roster.cycles c where team_id=${t.id} order by starts_at desc`,
  );
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
export function createCycleService(db: Database, options: { now?: () => Date } = {}): CycleService {
  const now = options.now ?? (() => new Date());
  async function resolve(db: Executor, ctx: RequestContext, w: Row, id: number) {
    if (!Number.isSafeInteger(id) || id < 1) fail('invalid_input', 'Invalid cycle id');
    const r = await one(
      db,
      sql`select t.key from roster.cycles c join roster.teams t on t.id=c.team_id where c.id=${id} and t.workspace_id=${w.id} and ${
        visible(ctx.identity.subject)
      }`,
    );
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
          const overlap = await rows(
            tx,
            sql`select 1 from roster.cycles where team_id=${t.id} and ends_at>${start.toInstant().toString()} limit 1`,
          );
          if (overlap.length) fail('conflict', 'Cycle schedules must not overlap');
        }
        if (old.enabled) await advanceTeamCycles(tx, t, clock);
        if (old.enabled && !cfg.enabled) {
          await close(tx, t, clock, false);
          await tx.execute(
            sql`update roster.issues set cycle_id=null,updated_at=${clock} where cycle_id in(select id from roster.cycles where team_id=${t.id} and completed_at is null)`,
          );
          await tx.execute(
            sql`delete from roster.cycles where team_id=${t.id} and completed_at is null`,
          );
        }
        await tx.execute(
          sql`insert into roster.team_cycle_settings(team_id,enabled,timezone,start_date,duration_weeks,upcoming_count) values(${t.id},${cfg.enabled},${cfg.timezone},${cfg.start_date},${cfg.duration_weeks},${cfg.upcoming_count}) on conflict(team_id) do update set enabled=excluded.enabled,timezone=excluded.timezone,start_date=excluded.start_date,duration_weeks=excluded.duration_weeks,upcoming_count=excluded.upcoming_count`,
        );
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
        const before = await one(tx, sql`select * from roster.cycles where id=${id}`);
        await tx.execute(
          sql`update roster.cycles set name=${value.name ?? before.name},description=${
            value.description ?? before.description
          } where id=${id}`,
        );
        await audit(tx, ctx, w, 'cycle.updated', before, value);
        return (await page(tx, t, clock)).cycles.find((c) => c.id === id) ??
          fail('not_found', 'Cycle not found');
      });
    },
  };
}
export async function validateIssueCycle(
  db: Executor,
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
  const c = await one(
    db,
    sql`select c.*,s.enabled from roster.cycles c join roster.team_cycle_settings s on s.team_id=c.team_id where c.id=${input} and c.team_id=${t.id}`,
  );
  if (!c.enabled || c.completed_at || new Date(iso(c.ends_at)) <= now) {
    fail('conflict', 'Cycle is closed or disabled');
  }
  return input;
}
/** Internal maintenance entrypoint; never expose as an authenticated end-user method. */
export async function advanceAllCycles(db: Database, now = new Date()) {
  const teams = await rows(
    db,
    sql`select t.* from roster.teams t join roster.team_cycle_settings s on s.team_id=t.id where s.enabled`,
  );
  for (const t of teams) {
    await db.transaction(async (tx) => {
      await one(tx, sql`select id from roster.workspaces where id=${t.workspace_id} for update`);
      await advanceTeamCycles(tx, t, now);
    });
  }
}
