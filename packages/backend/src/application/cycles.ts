import type { Cycle, CyclePage, CycleSettings } from '../../../contracts/cycles.ts';
import type { RequestContext } from '../../../contracts/mod.ts';
export interface CycleService {
  listCycles(ctx: RequestContext, slug: string, team: string): Promise<CyclePage>;
  configureCycles(
    ctx: RequestContext,
    slug: string,
    team: string,
    input: CycleSettings,
  ): Promise<CyclePage>;
  getCycle(ctx: RequestContext, slug: string, id: number): Promise<Cycle>;
  updateCycle(
    ctx: RequestContext,
    slug: string,
    id: number,
    input: { name?: string; description?: string },
  ): Promise<Cycle>;
}
