import type { GitHubRepository } from '../integrations/github/index.ts';
import type { AccessRepository } from '../modules/access/index.ts';
import type { ActivityRepository } from '../modules/activity/index.ts';
import type { AuditRepository } from '../modules/audit/index.ts';
import type { CyclesRepository } from '../modules/cycles/index.ts';
import type { IssuesRepository } from '../modules/issues/index.ts';
import type { LabelsRepository } from '../modules/labels/index.ts';
import type { PlanningRepository } from '../modules/planning/index.ts';
import type { SpecsRepository } from '../modules/specs/index.ts';

export interface Session {
  github: GitHubRepository;
  access: AccessRepository;
  planning: PlanningRepository;
  labels: LabelsRepository;
  cycles: CyclesRepository;
  specs: SpecsRepository;
  activity: ActivityRepository;
  issues: IssuesRepository;
  audit: AuditRepository;
}
export interface UnitOfWork extends Session {
  transaction<T>(run: (session: Session) => Promise<T>): Promise<T>;
}
