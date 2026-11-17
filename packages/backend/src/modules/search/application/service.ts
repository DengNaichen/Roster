import { z } from 'zod';
import { AppError, type RequestContext } from '../../../../../contracts/mod.ts';
import {
  type SearchInput,
  type SearchPage,
  searchSchema,
} from '../../../../../contracts/search.ts';
import type { UnitOfWork } from '../../../application/session.ts';
import { workspace } from '../../access/index.ts';
import type { SearchPosition } from './repository.ts';
const cursorSchema = z.strictObject({
  workspace: z.string(),
  subject: z.string(),
  query: z.string(),
  type: z.string(),
  rank: z.number().int().min(0).max(3),
  time: z.iso.datetime(),
  key: z.string().min(1).max(100),
});
function invalidCursor(): never {
  throw new AppError('invalid_input', 'Search cursor is invalid or belongs to another query');
}
function decode(value: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
        ),
      ),
    );
  } catch {
    return invalidCursor();
  }
}
function encode(value: z.infer<typeof cursorSchema>): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
}
export function createSearchService(db: UnitOfWork) {
  return {
    async search(ctx: RequestContext, slug: string, raw: SearchInput): Promise<SearchPage> {
      const parsed = searchSchema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError(
          'invalid_input',
          'Search requires a nonempty query, a valid type and a limit from 1 to 50',
        );
      }
      const input = parsed.data;
      const w = await workspace(db, ctx, slug);
      let after: SearchPosition | undefined;
      if (input.cursor) {
        const cursor = decode(input.cursor);
        if (
          cursor.workspace !== slug || cursor.subject !== ctx.identity.subject ||
          cursor.query !== input.query || cursor.type !== input.type
        ) invalidCursor();
        after = { rank: cursor.rank, time: cursor.time, key: cursor.key };
      }
      const rows = await db.search.search({
        workspaceId: w.id,
        subject: ctx.identity.subject,
        query: input.query,
        type: input.type,
        limit: input.limit + 1,
        after,
      });
      const page = rows.slice(0, input.limit), last = page.at(-1);
      return {
        results: page.map(({ rank: _rank, sort_time: _time, sort_key: _key, ...hit }) => hit),
        next_cursor: rows.length > input.limit && last
          ? encode({
            workspace: slug,
            subject: ctx.identity.subject,
            query: input.query,
            type: input.type,
            rank: last.rank,
            time: last.sort_time,
            key: last.sort_key,
          })
          : null,
      };
    },
  };
}
