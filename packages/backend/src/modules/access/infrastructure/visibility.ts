import { sql } from 'npm:drizzle-orm@0.45.4';
export function visible(subject: string) {
  return sql`(not t.private or exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${subject}))`;
}
