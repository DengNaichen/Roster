import type { z } from 'zod';
import type {
  addCommentSchema,
  addLinkSchema,
  addRelationSchema,
  addWorkLogSchema,
  Comment,
  delegateIssueSchema,
  Delegation,
  getWorkLogSchema,
  Link,
  listWorkLogsSchema,
  WorkLog,
  WorkLogPage,
} from '../../../contracts/activity.ts';
import type { RequestContext } from '../../../contracts/mod.ts';
export interface ActivityService {
  addComment(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof addCommentSchema>,
  ): Promise<Comment>;
  addWorkLog(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof addWorkLogSchema>,
  ): Promise<WorkLog>;
  listWorkLogs(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof listWorkLogsSchema>,
  ): Promise<WorkLogPage>;
  getWorkLog(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof getWorkLogSchema>,
  ): Promise<WorkLog>;
  delegateIssue(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof delegateIssueSchema>,
  ): Promise<Delegation>;
  addRelation(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof addRelationSchema>,
  ): Promise<void>;
  addLink(ctx: RequestContext, slug: string, input: z.input<typeof addLinkSchema>): Promise<Link>;
}
