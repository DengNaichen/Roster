import { z } from 'zod';
import type { Identity, RequestContext } from '../../../../../contracts/mod.ts';
import {
  createSpecSchema,
  getSpecRevisionSchema,
  listSpecsSchema,
  type Spec,
  type SpecContent,
  specContentSchema,
  type SpecRevision,
  type SpecRevisionSummary,
  updateSpecSchema,
} from '../../../../../contracts/spec.ts';
import type { Row } from '../../../application/records.ts';
import type { Session, UnitOfWork } from '../../../application/session.ts';
import type { SpecService } from '../../../application/spec.ts';
import { encodeSpec, ids } from '../domain/content.ts';

import { fail } from '../../../platform/errors/validation.ts';
import { iso } from '../../../platform/time.ts';
import { saveIdentity, team, workspace } from '../../access/index.ts';
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  return r.success
    ? r.data
    : fail('invalid_input', r.error.issues.map((e) => e.message).join('; '));
}
function author(r: Row): Identity | null {
  return r.author_subject
    ? {
      subject: String(r.author_subject),
      name: String(r.author_name),
      email: String(r.author_email),
    }
    : null;
}
function revisionSummary(r: Row): SpecRevisionSummary {
  return {
    number: Number(r.number),
    message: String(r.message),
    author: author(r),
    created_at: iso(r.created_at),
  };
}
function revision(r: Row): SpecRevision {
  return { ...revisionSummary(r), content: parse(specContentSchema, r.content) };
}
async function ref(db: Session, ctx: RequestContext, w: Row, identifier: string): Promise<Row> {
  if (!/^SPEC-[1-9][0-9]*$/.test(identifier)) fail('not_found', 'Spec not found');
  const number = Number(identifier.slice(5));
  if (!Number.isSafeInteger(number) || number > 2147483647) fail('not_found', 'Spec not found');
  return db.specs.findSpec({ workspaceId: w.id, number, subject: ctx.identity.subject });
}
async function get(db: Session, ctx: RequestContext, w: Row, identifier: string): Promise<Spec> {
  const sp = await ref(db, ctx, w, identifier);
  const r = await db.specs.currentRevision({
    specId: sp.id,
    current_revision: sp.current_revision,
  });
  return {
    identifier,
    team: String(sp.team),
    revision: Number(sp.current_revision),
    message: String(r.message),
    author: author(r),
    created_at: iso(sp.created_at),
    updated_at: iso(sp.updated_at),
    content: parse(specContentSchema, r.content),
  };
}
export function createSpecService(db: UnitOfWork, options: { now?: () => Date } = {}): SpecService {
  const clock = options.now ?? (() => new Date());
  return {
    async listSpecs(ctx, slug, input = {}) {
      const q = parse(listSpecsSchema, input);
      const w = await workspace(db, ctx, slug);
      const t = q.team ? await team(db, ctx, w, q.team) : null;
      const result = await db.specs.listSpecs({
        workspaceId: w.id,
        subject: ctx.identity.subject,
        hasTeam: Boolean(t),
        teamId: t ? (t.id) : undefined,
      });
      return result.map((r) => ({
        identifier: 'SPEC-' + r.number,
        team: String(r.team),
        title: String(r.title),
        status: r.status as SpecContent['status'],
        revision: Number(r.current_revision),
        updated_at: iso(r.updated_at),
      }));
    },
    async getSpec(ctx, slug, identifier) {
      const w = await workspace(db, ctx, slug);
      return get(db, ctx, w, identifier);
    },
    async createSpec(ctx, slug, input) {
      const value = parse(createSpecSchema, input);
      const content = encodeSpec(value.content);
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, value.team);
        await saveIdentity(tx, ctx);
        const number = Number(
          (await tx.specs.nextNumber({ workspaceId: w.id })).number,
        );
        const now = clock();
        const sp = await tx.specs.insertSpec({ workspaceId: w.id, teamId: t.id, number, now });
        await tx.specs.insertFirstRevision({
          specId: sp.id,
          content,
          message: value.message ?? '',
          subject: ctx.identity.subject,
          now,
        });
        return get(tx, ctx, w, 'SPEC-' + number);
      });
    },
    async updateSpec(ctx, slug, input) {
      const value = parse(updateSpecSchema, input);
      const content = encodeSpec(value.content);
      const incoming = ids(value.content);
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const sp = await ref(tx, ctx, w, value.identifier);
        if (Number(sp.current_revision) !== value.base_revision) {
          fail('conflict', 'Spec changed since base_revision; reload before saving');
        }
        const history = await tx.specs.revisionHistory({ specId: sp.id });
        const ever = new Set<string>(), current = new Set<string>();
        for (const r of history) {
          for (const id of ids(parse(specContentSchema, r.content))) {
            ever.add(id);
            if (Number(r.number) === value.base_revision) current.add(id);
          }
        }
        for (const id of incoming) {
          if (ever.has(id) && !current.has(id)) {
            fail('invalid_input', `${id} was removed in an earlier revision and cannot be reused`);
          }
        }
        const next = value.base_revision + 1;
        const now = clock();
        await saveIdentity(tx, ctx);
        const changed = await tx.specs.advanceRevision({
          next,
          now,
          specId: sp.id,
          base_revision: value.base_revision,
        });
        if (changed.length !== 1) fail('conflict', 'Spec changed since base_revision');
        await tx.specs.insertRevision({
          specId: sp.id,
          next,
          content,
          message: value.message ?? '',
          subject: ctx.identity.subject,
          now,
        });
        return get(tx, ctx, w, value.identifier);
      });
    },
    async listSpecRevisions(ctx, slug, identifier) {
      const w = await workspace(db, ctx, slug);
      const sp = await ref(db, ctx, w, identifier);
      return (await db.specs.listRevisions({ specId: sp.id })).map(revisionSummary);
    },
    async getSpecRevision(ctx, slug, input) {
      const value = parse(getSpecRevisionSchema, input);
      const w = await workspace(db, ctx, slug);
      const sp = await ref(db, ctx, w, value.identifier);
      return revision(
        await db.specs.findRevision({ specId: sp.id, number: value.number }),
      );
    },
  };
}
