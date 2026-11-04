import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, rows } from '../../../platform/database/query.ts';
import { visible } from '../../access/postgres.ts';
import type { CyclesRepository } from '../application/repository.ts';

export function createCyclesRepository(db: Executor): CyclesRepository {
  return {
    async settings({ id }) {
      return rows(
        db,
        sql`select enabled,timezone,to_char(start_date,'YYYY-MM-DD') as start_date,duration_weeks,upcoming_count from roster.team_cycle_settings where team_id=${id}`,
      );
    },
    async pendingCycles({ teamId, roll, now }) {
      return rows(
        db,
        sql`select * from roster.cycles where team_id=${teamId} and completed_at is null and ${
          roll ? sql`ends_at<=${now}` : sql`starts_at<${now}`
        } order by starts_at`,
      );
    },
    async issueCounts({ cycleId }) {
      return one(
        db,
        sql`select count(*)::int as total,count(*) filter(where status='done')::int as done,count(*) filter(where status='canceled')::int as canceled,count(*) filter(where status in ('todo','agent_ready','in_progress','in_review'))::int as moving from roster.issues where cycle_id=${cycleId}`,
      );
    },
    async completeCycle({ end, total, done, canceled, moving, cycleId }) {
      await db.execute(
        sql`update roster.cycles set completed_at=${end},ends_at=${end},total=${total},done=${done},canceled=${canceled},rolled_over=${moving} where id=${cycleId}`,
      );
    },
    async nextCycle({ teamId, ends_at }) {
      return one(
        db,
        sql`select id from roster.cycles where team_id=${teamId} and starts_at>=${ends_at} order by starts_at limit 1`,
      );
    },
    async cycleTail({ teamId }) {
      return one(
        db,
        sql`select max(ends_at) as last_end,coalesce(max(number),0)::int as number from roster.cycles where team_id=${teamId}`,
      );
    },
    async futureCount({ teamId, now }) {
      return one(
        db,
        sql`select count(*)::int as n from roster.cycles where team_id=${teamId} and completed_at is null and starts_at>${now}`,
      );
    },
    async insertCycle({ workspace_id, teamId, number, timezone, startsAt, endsAt }) {
      await db.execute(
        sql`insert into roster.cycles(workspace_id,team_id,number,timezone,starts_at,ends_at) values(${workspace_id},${teamId},${number},${timezone},${startsAt},${endsAt})`,
      );
    },
    async cyclePage({ teamId }) {
      return rows(
        db,
        sql`select c.*,case when c.completed_at is null then (select count(*)::int from roster.issues where cycle_id=c.id) else c.total end as total,case when c.completed_at is null then (select count(*)::int from roster.issues where cycle_id=c.id and status='done') else c.done end as done,case when c.completed_at is null then (select count(*)::int from roster.issues where cycle_id=c.id and status='canceled') else c.canceled end as canceled from roster.cycles c where team_id=${teamId} order by starts_at desc`,
      );
    },
    async resolveTeam({ id, workspaceId, subject }) {
      return one(
        db,
        sql`select t.key from roster.cycles c join roster.teams t on t.id=c.team_id where c.id=${id} and t.workspace_id=${workspaceId} and ${
          visible(subject)
        }`,
      );
    },
    async overlappingCycles({ teamId, startsAt }) {
      return rows(
        db,
        sql`select 1 from roster.cycles where team_id=${teamId} and ends_at>${startsAt} limit 1`,
      );
    },
    async deletePendingCycles({ teamId }) {
      await db.execute(
        sql`delete from roster.cycles where team_id=${teamId} and completed_at is null`,
      );
    },
    async saveSettings({ teamId, enabled, timezone, start_date, duration_weeks, upcoming_count }) {
      await db.execute(
        sql`insert into roster.team_cycle_settings(team_id,enabled,timezone,start_date,duration_weeks,upcoming_count) values(${teamId},${enabled},${timezone},${start_date},${duration_weeks},${upcoming_count}) on conflict(team_id) do update set enabled=excluded.enabled,timezone=excluded.timezone,start_date=excluded.start_date,duration_weeks=excluded.duration_weeks,upcoming_count=excluded.upcoming_count`,
      );
    },
    async insertSettingsIfMissing(
      { teamId, enabled, timezone, start_date, duration_weeks, upcoming_count },
    ) {
      await db.execute(
        sql`insert into roster.team_cycle_settings(team_id,enabled,timezone,start_date,duration_weeks,upcoming_count) values(${teamId},${enabled},${timezone},${start_date},${duration_weeks},${upcoming_count}) on conflict(team_id) do nothing`,
      );
    },
    async findCycle({ id }) {
      return one(db, sql`select * from roster.cycles where id=${id}`);
    },
    async updateCycle({ name, description, id }) {
      await db.execute(
        sql`update roster.cycles set name=${name},description=${description} where id=${id}`,
      );
    },
    async issueCycle({ cycleId, teamId }) {
      return one(
        db,
        sql`select c.*,s.enabled from roster.cycles c join roster.team_cycle_settings s on s.team_id=c.team_id where c.id=${cycleId} and c.team_id=${teamId}`,
      );
    },
    async enabledTeams() {
      return rows(
        db,
        sql`select t.* from roster.teams t join roster.team_cycle_settings s on s.team_id=t.id where s.enabled`,
      );
    },
  };
}
