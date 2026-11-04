import type { z } from 'zod';
import type { RequestContext } from '../../../contracts/mod.ts';
import type {
  changeSpecIssuesSchema,
  createSpecSchema,
  getSpecRevisionSchema,
  listIssueSpecsSchema,
  listSpecsSchema,
  setSpecDesignSchema,
  Spec,
  SpecIssueChange,
  SpecRevision,
  SpecRevisionSummary,
  SpecSummary,
  StoredDesign,
  updateSpecSchema,
} from '../../../contracts/spec.ts';
export interface SpecService {
  getSpecDesign(
    ctx: RequestContext,
    slug: string,
    identifier: string,
  ): Promise<{ identifier: string; design: StoredDesign | null }>;
  setSpecDesign(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof setSpecDesignSchema>,
  ): Promise<{ identifier: string; design: StoredDesign }>;
  linkSpecIssues(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof changeSpecIssuesSchema>,
  ): Promise<SpecIssueChange>;
  unlinkSpecIssues(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof changeSpecIssuesSchema>,
  ): Promise<SpecIssueChange>;
  listIssueSpecs(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof listIssueSpecsSchema>,
  ): Promise<SpecSummary[]>;
  listSpecs(
    ctx: RequestContext,
    slug: string,
    input?: z.input<typeof listSpecsSchema>,
  ): Promise<SpecSummary[]>;
  getSpec(ctx: RequestContext, slug: string, identifier: string): Promise<Spec>;
  createSpec(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof createSpecSchema>,
  ): Promise<Spec>;
  updateSpec(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof updateSpecSchema>,
  ): Promise<Spec>;
  listSpecRevisions(
    ctx: RequestContext,
    slug: string,
    identifier: string,
  ): Promise<SpecRevisionSummary[]>;
  getSpecRevision(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof getSpecRevisionSchema>,
  ): Promise<SpecRevision>;
}
