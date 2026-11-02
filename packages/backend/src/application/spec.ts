import type { z } from 'zod';
import type { RequestContext } from '../../../contracts/mod.ts';
import type {
  createSpecSchema,
  getSpecRevisionSchema,
  listSpecsSchema,
  Spec,
  SpecRevision,
  SpecRevisionSummary,
  SpecSummary,
  updateSpecSchema,
} from '../../../contracts/spec.ts';
export interface SpecService {
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
