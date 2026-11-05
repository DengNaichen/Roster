import { z } from 'zod';
import type { Identity, RequestContext } from '../../../../../contracts/mod.ts';
import {
  changeSpecIssuesSchema,
  createSpecSchema,
  getSpecRevisionSchema,
  listIssueSpecsSchema,
  listSpecsSchema,
  setSpecDesignSchema,
  type Spec,
  specContentSchema,
  specDependenciesSchema,
  type SpecRevision,
  type SpecRevisionSummary,
  specStoredStatusSchema,
  storedDesignSchema,
  updateSpecSchema,
} from '../../../../../contracts/spec.ts';
import type { Row } from '../../../application/records.ts';
import type { Session, UnitOfWork } from '../../../application/session.ts';
import type { SpecService } from '../../../application/spec.ts';
import { encodeSpec, ids } from '../domain/content.ts';

import { fail } from '../../../platform/errors/validation.ts';
import { iso } from '../../../platform/time.ts';
import { saveIdentity, team, workspace } from '../../access/index.ts';
import { readIssue } from '../../issues/index.ts';
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
function activeRevision(r: Row) {
  return r.active_number == null
    ? null
    : { number: Number(r.active_number), title: String(r.active_title) };
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
export async function readSpec(
  db: Session,
  ctx: RequestContext,
  w: Row,
  identifier: string,
): Promise<Row> {
  if (!/^SPEC-[1-9][0-9]*$/.test(identifier)) fail('not_found', 'Spec not found');
  const number = Number(identifier.slice(5));
  if (!Number.isSafeInteger(number) || number > 2147483647) fail('not_found', 'Spec not found');
  return db.specs.findSpec({ workspaceId: w.id, number, subject: ctx.identity.subject });
}
async function get(db: Session, ctx: RequestContext, w: Row, identifier: string): Promise<Spec> {
  const sp = await readSpec(db, ctx, w, identifier);
  const r = await db.specs.currentRevision({
    specId: sp.id,
    current_revision: sp.current_revision,
  });
  return {
    identifier,
    active_revision: activeRevision(sp),
    team: String(sp.team),
    issue_progress: { done: Number(sp.done), total: Number(sp.total) },
    revision: Number(sp.current_revision),
    message: String(r.message),
    author: author(r),
    created_at: iso(sp.created_at),
    updated_at: iso(sp.updated_at),
    content: parse(specContentSchema, r.content),
  };
}
function specSummary(r: Row) {
  return {
    identifier: 'SPEC-' + r.number,
    active_revision: activeRevision(r),
    team: String(r.team),
    issue_progress: { done: Number(r.done), total: Number(r.total) },
    title: String(r.title),
    status: parse(specStoredStatusSchema, r.status),
    revision: Number(r.current_revision),
    updated_at: iso(r.updated_at),
  };
}
export function createSpecService(db: UnitOfWork, options: { now?: () => Date } = {}): SpecService {
  const clock = options.now ?? (() => new Date());
  async function changeLinks(ctx: RequestContext, slug: string, input: unknown, linked: boolean) {
    const value = parse(changeSpecIssuesSchema, input);
    return db.transaction(async (tx) => {
      const w = await workspace(tx, ctx, slug, true);
      const spec = await readSpec(tx, ctx, w, value.identifier);
      const issueIds = [];
      for (const identifier of value.issues) {
        issueIds.push((await readIssue(tx, ctx, w, identifier)).id);
      }
      if (linked) {
        await saveIdentity(tx, ctx);
        await tx.specs.linkIssues({
          workspaceId: w.id,
          specId: spec.id,
          issueIds,
          subject: ctx.identity.subject,
          now: clock(),
        });
      } else {
        await tx.specs.unlinkIssues({ specId: spec.id, issueIds });
      }
      return { identifier: value.identifier, issues: value.issues, linked };
    });
  }
  return {
    linkSpecIssues: (ctx, slug, input) => changeLinks(ctx, slug, input, true),
    unlinkSpecIssues: (ctx, slug, input) => changeLinks(ctx, slug, input, false),
    async listIssueSpecs(ctx, slug, input) {
      const value = parse(listIssueSpecsSchema, input);
      const w = await workspace(db, ctx, slug);
      const issue = await readIssue(db, ctx, w, value.issue);
      return (await db.specs.listIssueSpecs({
        workspaceId: w.id,
        issueId: issue.id,
        subject: ctx.identity.subject,
      })).map(specSummary);
    },
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
      return result.map(specSummary);
    },
    async getSpecDependencies(ctx, slug, identifier) {
      const w = await workspace(db, ctx, slug);
      const sp = await readSpec(db, ctx, w, identifier);
      return specDependenciesSchema.parse(
        await db.specs.dependencies({
          workspaceId: w.id,
          specId: sp.id,
          subject: ctx.identity.subject,
        }),
      );
    },
    async getSpecDesign(ctx, slug, identifier) {
      const w = await workspace(db, ctx, slug);
      const sp = await readSpec(db, ctx, w, identifier);
      const [row] = await db.specs.getDesign(sp.id);
      return { identifier, design: row ? storedDesignSchema.parse(row) : null };
    },
    async setSpecDesign(ctx, slug, input) {
      const value = parse(setSpecDesignSchema, input);
      const content = JSON.stringify(value.content);
      if (new TextEncoder().encode(content).length > 262144) {
        fail('invalid_input', 'Design content is larger than 256 KiB');
      }
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const sp = await readSpec(tx, ctx, w, value.identifier);
        if (value.spec_revision > Number(sp.current_revision)) {
          fail('invalid_input', 'Unknown spec revision');
        }
        await saveIdentity(tx, ctx);
        const [row] = await tx.specs.saveDesign({
          specId: sp.id,
          base: value.base_revision,
          specRevision: value.spec_revision,
          content,
          subject: ctx.identity.subject,
          now: clock(),
        });
        if (!row) fail('conflict', 'Design changed since base_revision; read it again');
        return { identifier: value.identifier, design: storedDesignSchema.parse(row) };
      });
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
        const sp = await readSpec(tx, ctx, w, value.identifier);
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
      const sp = await readSpec(db, ctx, w, identifier);
      return (await db.specs.listRevisions({ specId: sp.id })).map(revisionSummary);
    },
    async getSpecRevision(ctx, slug, input) {
      const value = parse(getSpecRevisionSchema, input);
      const w = await workspace(db, ctx, slug);
      const sp = await readSpec(db, ctx, w, value.identifier);
      return revision(
        await db.specs.findRevision({ specId: sp.id, number: value.number }),
      );
    },
  };
}
