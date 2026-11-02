import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, rows } from '../../../platform/database/query.ts';
import type { AccessRepository } from '../application/repository.ts';
import { visible } from '../postgres.ts';

export function createAccessRepository(db: Executor): AccessRepository {
  return {
    async ensureGitHubIdentity() {
      await db.execute(
        sql`insert into roster.users(subject,name,email) values('system:github','GitHub','') on conflict do nothing`,
      );
    },

    async nextIssueNumber(teamId) {
      return Number(
        (await one(
          db,
          sql`update roster.teams set next_number=next_number+1 where id=${teamId} returning next_number-1 as n`,
        )).n,
      );
    },

    async saveIdentity({ subject, name, email }) {
      await db.execute(
        sql`insert into roster.users(subject,name,email) values(${subject},${name},${email}) on conflict(subject) do update set name=excluded.name,email=excluded.email`,
      );
    },
    async findWorkspace({ slug, lock }) {
      return one(
        db,
        sql`select * from roster.workspaces where slug=${slug}${lock ? sql` for update` : sql``}`,
      );
    },
    async activeMembership({ workspaceId, subject }) {
      return rows(
        db,
        sql`select role from roster.workspace_members where workspace_id=${workspaceId} and subject=${subject} and status='active'`,
      );
    },
    async findTeam({ subject, workspaceId, key }) {
      return one(
        db,
        sql`select t.*, exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${subject}) as joined, exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${subject} and tm.role='owner') as owner from roster.teams t where t.workspace_id=${workspaceId} and t.key=${key}`,
      );
    },
    async listWorkspaces({ subject }) {
      return rows(
        db,
        sql`select w.*,m.role from roster.workspaces w join roster.workspace_members m on m.workspace_id=w.id where m.subject=${subject} and m.status='active' order by w.slug`,
      );
    },
    async insertWorkspace({ slug, name }) {
      return one(
        db,
        sql`insert into roster.workspaces(slug,name) values(${slug},${name}) returning *`,
      );
    },
    async insertAdministrator({ workspaceId, subject }) {
      await db.execute(
        sql`insert into roster.workspace_members values(${workspaceId},${subject},'admin','active')`,
      );
    },
    async renameWorkspace({ name, workspaceId }) {
      return one(
        db,
        sql`update roster.workspaces set name=${name} where id=${workspaceId} returning *`,
      );
    },
    async listMembers({ workspaceId }) {
      return rows(
        db,
        sql`select u.*,m.role,m.status from roster.workspace_members m join roster.users u on u.subject=m.subject where m.workspace_id=${workspaceId} order by u.name,u.subject`,
      );
    },
    async findMember({ workspaceId, subject }) {
      return one(
        db,
        sql`select * from roster.workspace_members where workspace_id=${workspaceId} and subject=${subject}`,
      );
    },
    async countAdministrators({ workspaceId }) {
      return one(
        db,
        sql`select count(*)::int as n from roster.workspace_members where workspace_id=${workspaceId} and role='admin' and status='active'`,
      );
    },
    async updateMember({ role, status, workspaceId, subject }) {
      await db.execute(
        sql`update roster.workspace_members set role=${role},status=${status} where workspace_id=${workspaceId} and subject=${subject}`,
      );
    },
    async saveInvite({ workspaceId, digest }) {
      await db.execute(
        sql`insert into roster.workspace_invites values(${workspaceId},${digest}) on conflict(workspace_id) do update set digest=excluded.digest`,
      );
    },
    async lockInvitedWorkspace({ token }) {
      return one(
        db,
        sql`select w.* from roster.workspaces w join roster.workspace_invites v on v.workspace_id=w.id where v.digest=${token} for update of w`,
      );
    },
    async findInvite({ workspaceId, token }) {
      return rows(
        db,
        sql`select 1 from roster.workspace_invites where workspace_id=${workspaceId} and digest=${token}`,
      );
    },
    async findMembership({ workspaceId, subject }) {
      return rows(
        db,
        sql`select * from roster.workspace_members where workspace_id=${workspaceId} and subject=${subject}`,
      );
    },
    async joinWorkspace({ workspaceId, subject }) {
      await db.execute(
        sql`insert into roster.workspace_members values(${workspaceId},${subject},'member','active') on conflict do nothing`,
      );
    },
    async listTeams({ subject, workspaceId, isAdmin }) {
      return rows(
        db,
        sql`select t.*,exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${subject}) as joined,exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${subject} and tm.role='owner') as owner from roster.teams t where t.workspace_id=${workspaceId} and (${isAdmin} or ${
          visible(subject)
        }) order by t.key`,
      );
    },
    async insertTeam({ workspaceId, key, name, emoji, isPrivate, start_number }) {
      return one(
        db,
        sql`insert into roster.teams(workspace_id,key,name,emoji,private,next_number) values(${workspaceId},${key},${name},${emoji},${isPrivate},${start_number}) returning *`,
      );
    },
    async insertOwner({ workspaceId, teamId, subject }) {
      await db.execute(
        sql`insert into roster.team_members values(${workspaceId},${teamId},${subject},'owner')`,
      );
    },
    async updateTeam({ name, emoji, isPrivate, teamId }) {
      return one(
        db,
        sql`update roster.teams set name=${name},emoji=${emoji},private=${isPrivate} where id=${teamId} returning *`,
      );
    },
    async ensureOwner({ workspaceId, teamId, subject }) {
      await db.execute(
        sql`insert into roster.team_members values(${workspaceId},${teamId},${subject},'owner') on conflict(team_id,subject) do update set role='owner'`,
      );
    },
    async listAssignees({ workspaceId, publicTeam, teamId }) {
      return rows(
        db,
        sql`select u.* from roster.users u join roster.workspace_members wm on wm.subject=u.subject where wm.workspace_id=${workspaceId} and wm.status='active' and (${publicTeam} or exists(select 1 from roster.team_members tm where tm.team_id=${teamId} and tm.subject=u.subject)) order by u.name,u.subject`,
      );
    },
    async listTeamMembers({ teamId }) {
      return rows(
        db,
        sql`select u.*,case when wm.role='admin' then 'owner' else tm.role end as role,wm.status,(wm.role='admin') as workspace_admin from roster.team_members tm join roster.users u on u.subject=tm.subject join roster.workspace_members wm on wm.subject=tm.subject and wm.workspace_id=tm.workspace_id where tm.team_id=${teamId} order by u.name,u.subject`,
      );
    },
    async requireActiveMember({ workspaceId, subject }) {
      return one(
        db,
        sql`select 1 from roster.workspace_members where workspace_id=${workspaceId} and subject=${subject} and status='active'`,
      );
    },
    async removeTeamMember({ teamId, subject }) {
      await db.execute(
        sql`delete from roster.team_members where team_id=${teamId} and subject=${subject}`,
      );
    },
    async saveTeamMember({ workspaceId, teamId, subject, role }) {
      await db.execute(
        sql`insert into roster.team_members values(${workspaceId},${teamId},${subject},${role}) on conflict(team_id,subject) do update set role=excluded.role`,
      );
    },
    async leaveTeam({ teamId, subject }) {
      await db.execute(
        sql`delete from roster.team_members where team_id=${teamId} and subject=${subject}`,
      );
    },
    async joinTeam({ workspaceId, teamId, subject }) {
      await db.execute(
        sql`insert into roster.team_members values(${workspaceId},${teamId},${subject},'member') on conflict do nothing`,
      );
    },
    async lockWorkspace({ workspace_id }) {
      return one(db, sql`select id from roster.workspaces where id=${workspace_id} for update`);
    },
  };
}
