import { type SQL, sql } from 'npm:drizzle-orm@0.45.4';
import { visible } from '../../access/postgres.ts';
export function visibleProject(subject: string): SQL {
  return sql`(not exists(select 1 from roster.project_teams pt where pt.project_id=p.id) or exists(select 1 from roster.project_teams pt join roster.teams t on t.id=pt.team_id where pt.project_id=p.id and ${
    visible(subject)
  }))`;
}
export const projectColumns =
  sql`p.*,p.start_date::text as start_date,p.target_date::text as target_date`;
