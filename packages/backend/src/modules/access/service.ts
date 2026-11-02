import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Identity } from '../../../../contracts/mod.ts';
import type { Service } from '../../application/mod.ts';
import type { Database } from '../../platform/database/client.ts';
import { one, rows } from '../../platform/database/query.ts';
import { fail, text } from '../../platform/errors/validation.ts';
import { audit } from '../audit/index.ts';
import {
  admin,
  digest,
  identity,
  manager,
  saveIdentity,
  team,
  teamDTO,
  visible,
  workspace,
} from './index.ts';

export type AccessService = Pick<
  Service,
  | 'listWorkspaces'
  | 'createWorkspace'
  | 'updateWorkspace'
  | 'listMembers'
  | 'updateMember'
  | 'resetInvite'
  | 'joinWorkspace'
  | 'listTeams'
  | 'teamDirectory'
  | 'createTeam'
  | 'updateTeam'
  | 'listAssignees'
  | 'listTeamMembers'
  | 'changeTeamMember'
  | 'joinTeam'
>;
export function createAccessService(db: Database): AccessService {
  const service: AccessService = {
    async listWorkspaces(ctx) {
      identity(ctx);
      const rs = await rows(
        db,
        sql`select w.*,m.role from roster.workspaces w join roster.workspace_members m on m.workspace_id=w.id where m.subject=${ctx.identity.subject} and m.status='active' order by w.slug`,
      );
      return rs as unknown as Awaited<ReturnType<Service['listWorkspaces']>>;
    },
    async createWorkspace(ctx, input) {
      const name = text(input.name, 'Name');
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.slug)) {
        fail('invalid_input', 'Invalid workspace slug');
      }
      return db.transaction(async (tx) => {
        await saveIdentity(tx, ctx);
        const w = await one(
          tx,
          sql`insert into roster.workspaces(slug,name) values(${input.slug},${name}) returning *`,
        );
        await tx.execute(
          sql`insert into roster.workspace_members values(${w.id},${ctx.identity.subject},'admin','active')`,
        );
        await audit(tx, ctx, w, 'workspace.created', null, w);
        return { ...w, role: 'admin' } as unknown as Awaited<
          ReturnType<Service['createWorkspace']>
        >;
      });
    },
    async updateWorkspace(ctx, slug, input) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        admin(w);
        const n = await one(
          tx,
          sql`update roster.workspaces set name=${
            text(input.name, 'Name')
          } where id=${w.id} returning *`,
        );
        await audit(tx, ctx, w, 'workspace.updated', w, n);
        return { ...n, role: w.role } as unknown as Awaited<
          ReturnType<Service['updateWorkspace']>
        >;
      });
    },
    async listMembers(ctx, slug) {
      const w = await workspace(db, ctx, slug);
      return await rows(
        db,
        sql`select u.*,m.role,m.status from roster.workspace_members m join roster.users u on u.subject=m.subject where m.workspace_id=${w.id} order by u.name,u.subject`,
      ) as unknown as Awaited<ReturnType<Service['listMembers']>>;
    },
    async updateMember(ctx, slug, input) {
      if (
        !['admin', 'member'].includes(input.role) ||
        !['active', 'suspended'].includes(input.status)
      ) fail('invalid_input', 'Invalid membership');
      await db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        admin(w);
        const m = await one(
          tx,
          sql`select * from roster.workspace_members where workspace_id=${w.id} and subject=${input.subject}`,
        );
        if (
          m.role === 'admin' && m.status === 'active' &&
          (input.role !== 'admin' || input.status !== 'active')
        ) {
          const count = await one(
            tx,
            sql`select count(*)::int as n from roster.workspace_members where workspace_id=${w.id} and role='admin' and status='active'`,
          );
          if (count.n === 1) {
            fail('conflict', 'Cannot remove the last active administrator');
          }
        }
        await tx.execute(
          sql`update roster.workspace_members set role=${input.role},status=${input.status} where workspace_id=${w.id} and subject=${input.subject}`,
        );
        await audit(tx, ctx, w, 'member.updated', m, input);
      });
    },
    async resetInvite(ctx, slug) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        admin(w);
        const token = Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
        await tx.execute(
          sql`insert into roster.workspace_invites values(${w.id},${await digest(
            token,
          )}) on conflict(workspace_id) do update set digest=excluded.digest`,
        );
        await audit(tx, ctx, w, 'invite.reset', null, null);
        return { token };
      });
    },
    async joinWorkspace(ctx, input) {
      identity(ctx);
      return db.transaction(async (tx) => {
        const w = await one(
          tx,
          sql`select w.* from roster.workspaces w join roster.workspace_invites v on v.workspace_id=w.id where v.digest=${await digest(
            text(input.token, 'Token'),
          )} for update of w`,
        );
        // The invite join may have read before waiting for the workspace lock.
        // Read it again after the lock so a completed reset invalidates that snapshot.
        const currentInvite = (await rows(
          tx,
          sql`select 1 from roster.workspace_invites where workspace_id=${w.id} and digest=${await digest(
            input.token,
          )}`,
        ))[0];
        if (!currentInvite) fail('not_found', 'Invitation unavailable');
        const m = (await rows(
          tx,
          sql`select * from roster.workspace_members where workspace_id=${w.id} and subject=${ctx.identity.subject}`,
        ))[0];
        if (m?.status === 'suspended') {
          fail('forbidden', 'Membership is suspended');
        }
        await saveIdentity(tx, ctx);
        await tx.execute(
          sql`insert into roster.workspace_members values(${w.id},${ctx.identity.subject},'member','active') on conflict do nothing`,
        );
        await audit(tx, ctx, w, 'member.joined', null, {
          subject: ctx.identity.subject,
        });
        return { ...w, role: m?.role ?? 'member' } as unknown as Awaited<
          ReturnType<Service['joinWorkspace']>
        >;
      });
    },
    async listTeams(ctx, slug) {
      const all = await service.teamDirectory(ctx, slug);
      return all.filter((t) => t.accessible);
    },
    async teamDirectory(ctx, slug) {
      const w = await workspace(db, ctx, slug);
      const ts = await rows(
        db,
        sql`select t.*,exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${ctx.identity.subject}) as joined,exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${ctx.identity.subject} and tm.role='owner') as owner from roster.teams t where t.workspace_id=${w.id} and (${
          w.role === 'admin'
        } or ${visible(ctx.identity.subject)}) order by t.key`,
      );
      return ts.map((t) => teamDTO(t, w));
    },
    async createTeam(ctx, slug, input) {
      if (
        !/^[A-Z][A-Z0-9]{1,5}$/.test(input.key) ||
        !Number.isSafeInteger(input.start_number ?? 1) ||
        (input.start_number ?? 1) < 1
      ) fail('invalid_input', 'Invalid team key or starting number');
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await one(
          tx,
          sql`insert into roster.teams(workspace_id,key,name,emoji,private,next_number) values(${w.id},${input.key},${
            text(input.name, 'Name')
          },${input.emoji ?? ''},${input.private ?? false},${input.start_number ?? 1}) returning *`,
        );
        await tx.execute(
          sql`insert into roster.team_members values(${w.id},${t.id},${ctx.identity.subject},'owner')`,
        );
        await audit(tx, ctx, w, 'team.created', null, t);
        return teamDTO({ ...t, joined: true, owner: true }, w);
      });
    },
    async updateTeam(ctx, slug, key, input) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, key, true);
        if (input.private !== undefined) manager(t, w);
        if (input.private !== undefined && typeof input.private !== 'boolean') {
          fail('invalid_input', 'Invalid visibility');
        }
        const r = await one(
          tx,
          sql`update roster.teams set name=${
            input.name === undefined ? t.name : text(input.name, 'Name')
          },emoji=${input.emoji ?? t.emoji},private=${
            input.private ?? t.private
          } where id=${t.id} returning *`,
        );
        if (input.private && !t.private) {
          await tx.execute(
            sql`insert into roster.team_members values(${w.id},${t.id},${ctx.identity.subject},'owner') on conflict(team_id,subject) do update set role='owner'`,
          );
        }
        await audit(tx, ctx, w, 'team.updated', t, r);
        return teamDTO(await team(tx, ctx, w, key, true), w);
      });
    },
    async listAssignees(ctx, slug, key) {
      const w = await workspace(db, ctx, slug);
      const t = await team(db, ctx, w, key);
      return await rows(
        db,
        sql`select u.* from roster.users u join roster.workspace_members wm on wm.subject=u.subject where wm.workspace_id=${w.id} and wm.status='active' and (${!t
          .private} or exists(select 1 from roster.team_members tm where tm.team_id=${t.id} and tm.subject=u.subject)) order by u.name,u.subject`,
      ) as unknown as Identity[];
    },
    async listTeamMembers(ctx, slug, key) {
      const w = await workspace(db, ctx, slug);
      const t = await team(db, ctx, w, key, true);
      return await rows(
        db,
        sql`select u.*,case when wm.role='admin' then 'owner' else tm.role end as role,wm.status,(wm.role='admin') as workspace_admin from roster.team_members tm join roster.users u on u.subject=tm.subject join roster.workspace_members wm on wm.subject=tm.subject and wm.workspace_id=tm.workspace_id where tm.team_id=${t.id} order by u.name,u.subject`,
      ) as unknown as Awaited<ReturnType<Service['listTeamMembers']>>;
    },
    async changeTeamMember(ctx, slug, key, input) {
      if (!input.remove && !['owner', 'member'].includes(input.role ?? '')) {
        fail('invalid_input', 'Invalid team role');
      }
      await db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, key, true);
        manager(t, w);
        if (!input.remove) {
          await one(
            tx,
            sql`select 1 from roster.workspace_members where workspace_id=${w.id} and subject=${input.subject} and status='active'`,
          );
        }
        if (input.remove) {
          await tx.execute(
            sql`delete from roster.team_members where team_id=${t.id} and subject=${input.subject}`,
          );
        } else {await tx.execute(
            sql`insert into roster.team_members values(${w.id},${t.id},${input.subject},${input.role}) on conflict(team_id,subject) do update set role=excluded.role`,
          );}
        await audit(tx, ctx, w, 'team.member_changed', null, {
          team: key,
          ...input,
        });
      });
    },
    async joinTeam(ctx, slug, key, input) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, key, true);
        if (input.leave) {
          await tx.execute(
            sql`delete from roster.team_members where team_id=${t.id} and subject=${ctx.identity.subject}`,
          );
        } else {
          if (t.private && !t.joined) {
            admin(w);
            if (!input.confirm_private) {
              fail('invalid_input', 'Confirm private team access');
            }
          }
          await tx.execute(
            sql`insert into roster.team_members values(${w.id},${t.id},${ctx.identity.subject},'member') on conflict do nothing`,
          );
        }
        await audit(
          tx,
          ctx,
          w,
          input.leave ? 'team.left' : 'team.joined',
          null,
          { team: key },
        );
        return teamDTO({
          ...t,
          joined: !input.leave,
          owner: input.leave ? false : t.owner,
        }, w);
      });
    },
  };
  return service;
}
