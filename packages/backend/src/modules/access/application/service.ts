import { type Identity } from '../../../../../contracts/mod.ts';
import type { Service } from '../../../application/mod.ts';
import type { UnitOfWork } from '../../../application/session.ts';

import { fail, text } from '../../../platform/errors/validation.ts';
import { audit } from '../../audit/index.ts';
import {
  admin,
  digest,
  identity,
  manager,
  saveIdentity,
  team,
  teamDTO,
  workspace,
} from './context.ts';

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
export function createAccessService(db: UnitOfWork): AccessService {
  const service: AccessService = {
    async listWorkspaces(ctx) {
      identity(ctx);
      const rs = await db.access.listWorkspaces({ subject: ctx.identity.subject });
      return rs as unknown as Awaited<ReturnType<Service['listWorkspaces']>>;
    },
    async createWorkspace(ctx, input) {
      const name = text(input.name, 'Name');
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.slug)) {
        fail('invalid_input', 'Invalid workspace slug');
      }
      return db.transaction(async (tx) => {
        await saveIdentity(tx, ctx);
        const w = await tx.access.insertWorkspace({ slug: input.slug, name });
        await tx.access.insertAdministrator({ workspaceId: w.id, subject: ctx.identity.subject });
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
        const n = await tx.access.renameWorkspace({
          name: text(input.name, 'Name'),
          workspaceId: w.id,
        });
        await audit(tx, ctx, w, 'workspace.updated', w, n);
        return { ...n, role: w.role } as unknown as Awaited<
          ReturnType<Service['updateWorkspace']>
        >;
      });
    },
    async listMembers(ctx, slug) {
      const w = await workspace(db, ctx, slug);
      return await db.access.listMembers({ workspaceId: w.id }) as unknown as Awaited<
        ReturnType<Service['listMembers']>
      >;
    },
    async updateMember(ctx, slug, input) {
      if (
        !['admin', 'member'].includes(input.role) ||
        !['active', 'suspended'].includes(input.status)
      ) fail('invalid_input', 'Invalid membership');
      await db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        admin(w);
        const m = await tx.access.findMember({ workspaceId: w.id, subject: input.subject });
        if (
          m.role === 'admin' && m.status === 'active' &&
          (input.role !== 'admin' || input.status !== 'active')
        ) {
          const count = await tx.access.countAdministrators({ workspaceId: w.id });
          if (count.n === 1) {
            fail('conflict', 'Cannot remove the last active administrator');
          }
        }
        await tx.access.updateMember({
          role: input.role,
          status: input.status,
          workspaceId: w.id,
          subject: input.subject,
        });
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
        await tx.access.saveInvite({
          workspaceId: w.id,
          digest: await digest(
            token,
          ),
        });
        await audit(tx, ctx, w, 'invite.reset', null, null);
        return { token };
      });
    },
    async joinWorkspace(ctx, input) {
      identity(ctx);
      return db.transaction(async (tx) => {
        const w = await tx.access.lockInvitedWorkspace({
          token: await digest(
            text(input.token, 'Token'),
          ),
        });
        // The invite join may have read before waiting for the workspace lock.
        // Read it again after the lock so a completed reset invalidates that snapshot.
        const currentInvite = (await tx.access.findInvite({
          workspaceId: w.id,
          token: await digest(
            input.token,
          ),
        }))[0];
        if (!currentInvite) fail('not_found', 'Invitation unavailable');
        const m =
          (await tx.access.findMembership({ workspaceId: w.id, subject: ctx.identity.subject }))[0];
        if (m?.status === 'suspended') {
          fail('forbidden', 'Membership is suspended');
        }
        await saveIdentity(tx, ctx);
        await tx.access.joinWorkspace({ workspaceId: w.id, subject: ctx.identity.subject });
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
      const ts = await db.access.listTeams({
        subject: ctx.identity.subject,
        workspaceId: w.id,
        isAdmin: w.role === 'admin',
      });
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
        const t = await tx.access.insertTeam({
          workspaceId: w.id,
          key: input.key,
          name: text(input.name, 'Name'),
          emoji: input.emoji ?? '',
          isPrivate: input.private ?? false,
          start_number: input.start_number ?? 1,
        });
        await tx.access.insertOwner({
          workspaceId: w.id,
          teamId: t.id,
          subject: ctx.identity.subject,
        });
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
        const r = await tx.access.updateTeam({
          name: input.name === undefined ? t.name : text(input.name, 'Name'),
          emoji: input.emoji ?? t.emoji,
          isPrivate: input.private ?? t.private,
          teamId: t.id,
        });
        if (input.private && !t.private) {
          await tx.access.ensureOwner({
            workspaceId: w.id,
            teamId: t.id,
            subject: ctx.identity.subject,
          });
        }
        await audit(tx, ctx, w, 'team.updated', t, r);
        return teamDTO(await team(tx, ctx, w, key, true), w);
      });
    },
    async listAssignees(ctx, slug, key) {
      const w = await workspace(db, ctx, slug);
      const t = await team(db, ctx, w, key);
      return await db.access.listAssignees({
        workspaceId: w.id,
        publicTeam: !t
          .private,
        teamId: t.id,
      }) as unknown as Identity[];
    },
    async listTeamMembers(ctx, slug, key) {
      const w = await workspace(db, ctx, slug);
      const t = await team(db, ctx, w, key, true);
      return await db.access.listTeamMembers({ teamId: t.id }) as unknown as Awaited<
        ReturnType<Service['listTeamMembers']>
      >;
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
          await tx.access.requireActiveMember({ workspaceId: w.id, subject: input.subject });
        }
        if (input.remove) {
          await tx.access.removeTeamMember({ teamId: t.id, subject: input.subject });
        } else {await tx.access.saveTeamMember({
            workspaceId: w.id,
            teamId: t.id,
            subject: input.subject,
            role: input.role,
          });}
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
          await tx.access.leaveTeam({ teamId: t.id, subject: ctx.identity.subject });
        } else {
          if (t.private && !t.joined) {
            admin(w);
            if (!input.confirm_private) {
              fail('invalid_input', 'Confirm private team access');
            }
          }
          await tx.access.joinTeam({
            workspaceId: w.id,
            teamId: t.id,
            subject: ctx.identity.subject,
          });
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
