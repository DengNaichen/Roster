import type { Pool } from 'npm:pg@8.23.1';
import { addLinkSchema } from '../../../contracts/activity.ts';
import { createSpecSchema, type SpecContent, specContentSchema } from '../../../contracts/spec.ts';
import { encodeSpec } from '../modules/specs/index.ts';
type Row = Record<string, unknown>;
export type SQLiteSnapshot = { format: 'inftask-sqlite-v1'; tables: Record<string, Row[]> };
export type IdentityMap = {
  subjects: Record<string, string>;
  owner?: { subject: string; name: string; email: string };
};
const order = [
  'users',
  'workspaces',
  'workspace_members',
  'workspace_invites',
  'teams',
  'team_members',
  'projects',
  'project_teams',
  'initiatives',
  'initiative_projects',
  'label_groups',
  'labels',
  'team_cycle_settings',
  'cycles',
  'issues',
  'issue_labels',
  'comments',
  'work_logs',
  'issue_delegations',
  'relations',
  'links',
  'specs',
  'spec_revisions',
  'pull_requests',
  'github_sync',
] as const;
/** Offline migration into an empty Roster database, all rows or none. */
export async function importSQLite(pool: Pool, snapshot: SQLiteSnapshot, mapping: IdentityMap) {
  if (snapshot.format !== 'inftask-sqlite-v1' || !snapshot.tables) {
    throw new Error('Unsupported snapshot format');
  }
  const subject = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    const mapped = mapping.subjects[String(value)];
    if (!mapped || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(mapped)) {
      throw new Error(`Explicit Supabase identity mapping required for ${value}`);
    }
    return mapped;
  };
  const source = (table: string) => snapshot.tables[table] ?? [];
  for (const u of source('users')) subject(u.subject);
  const mapped = source('users').map((u) => subject(u.subject));
  if (new Set(mapped).size !== mapped.length) {
    throw new Error('Identity mapping must not merge distinct users');
  }
  if (mapping.owner && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(mapping.owner.subject)) {
    throw new Error('Owner must have a Supabase UUID');
  }
  const workspaces = new Map(source('workspaces').map((r) => [String(r.id), crypto.randomUUID()]));
  const teams = new Map(source('teams').map((r) => [String(r.id), crypto.randomUUID()]));
  const issues = new Map(source('issues').map((r) => [String(r.id), crypto.randomUUID()]));
  const lookup = (map: Map<string, string>, v: unknown) => {
    const id = map.get(String(v));
    if (!id) throw new Error(`Missing reference ${v}`);
    return id;
  };
  const sourceIssue = new Map(source('issues').map((r) => [String(r.id), r]));
  const sourceTeam = new Map(source('teams').map((r) => [String(r.id), r]));
  const sourceProject = new Map(source('projects').map((r) => [String(r.id), r]));
  const sourceInitiative = new Map(source('initiatives').map((r) => [String(r.id), r]));
  const sourceSpec = new Map(source('specs').map((r) => [String(r.id), r]));
  const normalizedSpecRevisions = new Map<Row, SpecContent>();
  const counts: Record<string, number> = {};
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(728615824)');
    const existing = await client.query('select count(*)::int as n from roster.workspaces');
    if (existing.rows[0].n) {
      throw new Error(
        'Import requires an empty Roster database; existing workspaces are never overwritten',
      );
    }
    const columns = await client.query(
      "select table_name,column_name,data_type,is_identity from information_schema.columns where table_schema='roster'",
    );
    const schema = new Map<string, Map<string, { data_type: string; is_identity: string }>>();
    for (const c of columns.rows) {
      if (!schema.has(c.table_name)) schema.set(c.table_name, new Map());
      schema.get(c.table_name)!.set(c.column_name, c);
    }
    async function insert(table: string, row: Row) {
      const allowed = schema.get(table);
      if (!allowed) throw new Error(`Apply migrations before import: ${table}`);
      const keys = Object.keys(row).filter((k) => allowed.has(k));
      const values = keys.map((k) =>
        allowed.get(k)!.data_type === 'boolean' ? Boolean(row[k]) : row[k]
      );
      await client.query(
        `insert into roster."${table}" (${
          keys.map((k) => `"${k}"`).join(',')
        }) overriding system value values(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
        values,
      );
      counts[table] = (counts[table] ?? 0) + 1;
    }
    await client.query(
      "insert into roster.users(subject,name,email) values('system:legacy','Imported system','') on conflict do nothing",
    );
    for (const table of order) {
      for (const input of source(table)) {
        const row = { ...input };
        if (table === 'users') {
          row.subject = subject(row.subject);
          await insert(table, row);
          continue;
        }
        if (table === 'workspaces') row.id = lookup(workspaces, input.id);
        if (table === 'teams') row.id = lookup(teams, input.id);
        if (table === 'issues') row.id = lookup(issues, input.id);
        let oldWorkspace = input.workspace_id;
        if (oldWorkspace === undefined) {
          if (input.spec_id !== undefined) {
            oldWorkspace = sourceSpec.get(String(input.spec_id))?.workspace_id;
          } else if (input.issue_id !== undefined) {
            oldWorkspace = sourceIssue.get(String(input.issue_id))?.workspace_id;
          } else if (input.team_id !== undefined) {
            oldWorkspace = sourceTeam.get(String(input.team_id))?.workspace_id;
          } else if (input.project_id !== undefined) {
            oldWorkspace = sourceProject.get(String(input.project_id))?.workspace_id;
          } else if (input.initiative_id !== undefined) {
            oldWorkspace = sourceInitiative.get(String(input.initiative_id))?.workspace_id;
          }
        }
        if (oldWorkspace !== undefined) row.workspace_id = lookup(workspaces, oldWorkspace);
        if (input.team_id !== undefined) row.team_id = lookup(teams, input.team_id);
        if (input.issue_id !== undefined) row.issue_id = lookup(issues, input.issue_id);
        if (input.other_id !== undefined) row.other_id = lookup(issues, input.other_id);
        if (
          table === 'relations' && row.kind === 'related' &&
          String(row.issue_id) > String(row.other_id)
        ) [row.issue_id, row.other_id] = [row.other_id, row.issue_id];
        for (const key of ['subject', 'assignee_subject', 'actor_subject', 'author_subject']) {
          if (input[key] !== undefined) row[key] = subject(input[key]);
        }
        if (table === 'comments' && input.actor_subject === undefined) row.actor_subject = null;
        if (table === 'links') {
          addLinkSchema.pick({ title: true, url: true }).parse({ title: row.title, url: row.url });
        }
        if (table === 'spec_revisions') {
          let decoded: unknown = input.content;
          if (typeof decoded === 'string') {
            try {
              decoded = JSON.parse(decoded);
            } catch {
              throw new Error('Spec revision content must be valid JSON');
            }
          }
          const parsed = specContentSchema.safeParse(decoded);
          if (!parsed.success) {
            throw new Error(
              'Invalid Spec revision content: ' +
                parsed.error.issues.map((i) => i.message).join('; '),
            );
          }
          row.content = encodeSpec(parsed.data);
          row.message = createSpecSchema.shape.message.parse(input.message) ?? '';
          normalizedSpecRevisions.set(input, parsed.data);
        }
        if (table === 'issues') row.parent_id = null; // second pass after every issue exists
        if (table === 'github_sync' && !row.last_updated_at) row.last_updated_at = null;
        await insert(table, row);
      }
    }
    // A snapshot must preserve every append-only revision and stable-ID tombstone.
    const revisionsBySpec = new Map<string, Row[]>();
    for (const revision of source('spec_revisions')) {
      const id = String(revision.spec_id);
      if (!sourceSpec.has(id)) throw new Error('Missing Spec revision parent ' + id);
      const list = revisionsBySpec.get(id) ?? [];
      list.push(revision);
      revisionsBySpec.set(id, list);
    }
    for (const spec of source('specs')) {
      const revisions = (revisionsBySpec.get(String(spec.id)) ?? []).sort((a, b) =>
        Number(a.number) - Number(b.number)
      );
      if (
        !Number.isSafeInteger(spec.current_revision) || Number(spec.current_revision) < 1 ||
        revisions.length !== spec.current_revision
      ) {
        throw new Error(
          'Spec revision history must include every revision through current_revision',
        );
      }
      const ever = new Set<string>();
      let previous = new Set<string>();
      for (let index = 0; index < revisions.length; index++) {
        const revision = revisions[index];
        if (revision.number !== index + 1) {
          throw new Error('Spec revision numbers must be contiguous from 1');
        }
        const content = normalizedSpecRevisions.get(revision)!;
        const current = new Set(
          [...content.stories, ...content.requirements, ...content.success_criteria].map((item) =>
            item.id
          ),
        );
        for (const id of current) {
          if (ever.has(id) && !previous.has(id)) {
            throw new Error('Retired Spec stable ID cannot be reused: ' + id);
          }
          ever.add(id);
        }
        previous = current;
      }
    }
    for (const input of source('issues')) {
      if (input.parent_id !== null && input.parent_id !== undefined) {
        await client.query('update roster.issues set parent_id=$1 where id=$2', [
          lookup(issues, input.parent_id),
          lookup(issues, input.id),
        ]);
      }
    }
    // Preserve the assignment history as audit records without inventing authors.
    for (const input of source('issue_assignments')) {
      const original = sourceIssue.get(String(input.issue_id));
      if (!original) throw new Error('Missing assignment issue');
      await insert('audit_events', {
        workspace_id: lookup(workspaces, original.workspace_id),
        issue_id: lookup(issues, input.issue_id),
        actor_subject: subject(input.actor_subject) ?? 'system:legacy',
        kind: 'issue.updated',
        before: JSON.stringify({ assignee_subject: subject(input.from_subject) }),
        after: JSON.stringify({ assignee_subject: subject(input.to_subject) }),
        created_at: input.created_at,
      });
    }
    for (const input of source('events')) {
      const original = sourceIssue.get(String(input.issue_id));
      if (!original) throw new Error('Missing event issue');
      await insert('audit_events', {
        workspace_id: lookup(workspaces, original.workspace_id),
        issue_id: lookup(issues, input.issue_id),
        actor_subject: 'system:legacy',
        kind: input.kind === 'created' ? 'issue.created' : 'issue.status_changed',
        before: 'null',
        after: JSON.stringify({ legacy_detail: input.detail }),
        created_at: input.created_at,
      });
    }
    if (mapping.owner) {
      await client.query(
        'insert into roster.users(subject,name,email) values($1,$2,$3) on conflict do nothing',
        [mapping.owner.subject, mapping.owner.name, mapping.owner.email],
      );
      for (const id of workspaces.values()) {
        await client.query(
          "insert into roster.workspace_members(workspace_id,subject,role,status) select $1,$2,'admin','active' where not exists(select 1 from roster.workspace_members where workspace_id=$1 and role='admin' and status='active') on conflict(workspace_id,subject) do update set role='admin',status='active'",
          [id, mapping.owner.subject],
        );
      }
    }
    const inaccessible = await client.query(
      "select slug from roster.workspaces w where not exists(select 1 from roster.workspace_members m where m.workspace_id=w.id and role='admin' and status='active')",
    );
    if (inaccessible.rows.length) {
      throw new Error(
        'Every imported workspace needs an active administrator; provide an explicit owner mapping',
      );
    }
    const badNumber = await client.query(
      'select key from roster.teams t where next_number <= coalesce((select max(number) from roster.issues where team_id=t.id),0)',
    );
    if (badNumber.rows.length) {
      throw new Error('Source team next_number would collide with existing issues');
    }
    // Advance numeric identities without reusing imported IDs.
    for (const [table, cols] of schema) {
      if (cols.get('id')?.is_identity === 'YES') {
        await client.query(
          `select setval(pg_get_serial_sequence('roster.${table}','id'),greatest(coalesce((select max(id) from roster."${table}"),0),1),(select count(*)>0 from roster."${table}"))`,
        );
      }
    }
    await client.query('commit');
    return {
      counts,
      workspaces: Object.fromEntries(workspaces),
      teams: Object.fromEntries(teams),
      issues: Object.fromEntries(issues),
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
