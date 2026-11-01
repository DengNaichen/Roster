import { sql } from 'npm:drizzle-orm@0.45.4';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import {
  createSpecSchema,
  getSpecRevisionSchema,
  listSpecsSchema,
  type Spec,
  type SpecContent,
  specContentSchema,
  type SpecRevision,
  type SpecRevisionSummary,
  type SpecService,
  updateSpecSchema,
} from '../../../contracts/spec.ts';
import type { Identity, RequestContext } from '../../../contracts/mod.ts';
import {
  type Executor,
  fail,
  iso,
  one,
  type Row,
  rows,
  saveIdentity,
  team,
  visible,
  workspace,
} from './shared.ts';
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  return r.success
    ? r.data
    : fail('invalid_input', r.error.issues.map((e) => e.message).join('; '));
}
function ids(content: SpecContent) {
  return new Set(
    [...content.stories, ...content.requirements, ...content.success_criteria].map((i) => i.id),
  );
}
/** Match Go JSON normalization and count encoded UTF-8 bytes, not UTF-16 string length. */
export function encodeSpec(content: SpecContent): string {
  const normalized = { ...content };
  if (!normalized.branch) delete normalized.branch;
  normalized.requirements = content.requirements.map((r) => {
    const value = { ...r };
    if (!value.clarify) delete value.clarify;
    return value;
  });
  const encoded = JSON.stringify(normalized).replace(
    /[<>&\u2028\u2029]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  if (new TextEncoder().encode(encoded).length > 256 * 1024) {
    fail('invalid_input', 'Spec content is larger than 256 KiB');
  }
  return encoded;
}
const revisionColumns =
  sql`r.number,r.message,r.created_at,r.content,u.subject as author_subject,u.name as author_name,u.email as author_email`;
const revisionFrom =
  sql`from roster.spec_revisions r left join roster.users u on u.subject=r.author_subject`;
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
async function ref(db: Executor, ctx: RequestContext, w: Row, identifier: string): Promise<Row> {
  if (!/^SPEC-[1-9][0-9]*$/.test(identifier)) fail('not_found', 'Spec not found');
  const number = Number(identifier.slice(5));
  if (!Number.isSafeInteger(number) || number > 2147483647) fail('not_found', 'Spec not found');
  return one(
    db,
    sql`select sp.*,t.key as team from roster.specs sp join roster.teams t on t.id=sp.team_id where sp.workspace_id=${w.id} and sp.number=${number} and ${
      visible(ctx.identity.subject)
    }`,
  );
}
async function get(db: Executor, ctx: RequestContext, w: Row, identifier: string): Promise<Spec> {
  const sp = await ref(db, ctx, w, identifier);
  const r = await one(
    db,
    sql`select ${revisionColumns} ${revisionFrom} where r.spec_id=${sp.id} and r.number=${sp.current_revision}`,
  );
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
export function createSpecService(db: Database, options: { now?: () => Date } = {}): SpecService {
  const clock = options.now ?? (() => new Date());
  return {
    async listSpecs(ctx, slug, input = {}) {
      const q = parse(listSpecsSchema, input);
      const w = await workspace(db, ctx, slug);
      const t = q.team ? await team(db, ctx, w, q.team) : null;
      const result = await rows(
        db,
        sql`select sp.number,t.key as team,r.content->>'title' as title,r.content->>'status' as status,sp.current_revision,sp.updated_at from roster.specs sp join roster.teams t on t.id=sp.team_id join roster.spec_revisions r on r.spec_id=sp.id and r.number=sp.current_revision where sp.workspace_id=${w.id} and ${
          visible(ctx.identity.subject)
        } ${t ? sql`and sp.team_id=${t.id}` : sql``} order by sp.updated_at desc,sp.id desc`,
      );
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
          (await one(
            tx,
            sql`select coalesce(max(number),0)+1 as number from roster.specs where workspace_id=${w.id}`,
          )).number,
        );
        const now = clock();
        const sp = await one(
          tx,
          sql`insert into roster.specs(workspace_id,team_id,number,current_revision,created_at,updated_at) values(${w.id},${t.id},${number},1,${now},${now}) returning id`,
        );
        await tx.execute(
          sql`insert into roster.spec_revisions(spec_id,number,content,message,author_subject,created_at) values(${sp.id},1,${content}::json,${
            value.message ?? ''
          },${ctx.identity.subject},${now})`,
        );
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
        const history = await rows(
          tx,
          sql`select number,content from roster.spec_revisions where spec_id=${sp.id}`,
        );
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
        const changed = await rows(
          tx,
          sql`update roster.specs set current_revision=${next},updated_at=${now} where id=${sp.id} and current_revision=${value.base_revision} returning id`,
        );
        if (changed.length !== 1) fail('conflict', 'Spec changed since base_revision');
        await tx.execute(
          sql`insert into roster.spec_revisions(spec_id,number,content,message,author_subject,created_at) values(${sp.id},${next},${content}::json,${
            value.message ?? ''
          },${ctx.identity.subject},${now})`,
        );
        return get(tx, ctx, w, value.identifier);
      });
    },
    async listSpecRevisions(ctx, slug, identifier) {
      const w = await workspace(db, ctx, slug);
      const sp = await ref(db, ctx, w, identifier);
      return (await rows(
        db,
        sql`select ${revisionColumns} ${revisionFrom} where r.spec_id=${sp.id} order by r.number desc`,
      )).map(revisionSummary);
    },
    async getSpecRevision(ctx, slug, input) {
      const value = parse(getSpecRevisionSchema, input);
      const w = await workspace(db, ctx, slug);
      const sp = await ref(db, ctx, w, value.identifier);
      return revision(
        await one(
          db,
          sql`select ${revisionColumns} ${revisionFrom} where r.spec_id=${sp.id} and r.number=${value.number}`,
        ),
      );
    },
  };
}
