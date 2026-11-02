import type { Session, UnitOfWork } from '../../application/session.ts';
import { createGitHubRepository } from '../../integrations/github/postgres.ts';
import { createAccessRepository } from '../../modules/access/postgres.ts';
import { createActivityRepository } from '../../modules/activity/postgres.ts';
import { createAuditRepository } from '../../modules/audit/postgres.ts';
import { createCyclesRepository } from '../../modules/cycles/postgres.ts';
import { createIssuesRepository } from '../../modules/issues/postgres.ts';
import { createLabelsRepository } from '../../modules/labels/postgres.ts';
import { createPlanningRepository } from '../../modules/planning/postgres.ts';
import { createSpecsRepository } from '../../modules/specs/postgres.ts';
import type { Database } from './client.ts';
import type { Executor } from './query.ts';

export function createSession(db: Executor): Session {
  return {
    github: createGitHubRepository(db),
    access: createAccessRepository(db),
    planning: createPlanningRepository(db),
    labels: createLabelsRepository(db),
    cycles: createCyclesRepository(db),
    specs: createSpecsRepository(db),
    activity: createActivityRepository(db),
    issues: createIssuesRepository(db),
    audit: createAuditRepository(db),
  };
}
export function createUnitOfWork(db: Database): UnitOfWork {
  return {
    ...createSession(db),
    transaction: (run) => db.transaction((tx) => run(createSession(tx))),
  };
}
