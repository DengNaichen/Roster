import type { Service } from './application/mod.ts';
import { createUnitOfWork } from './platform/database/session.ts';

import { guardService } from './application/guard.ts';
import { createAccessService } from './modules/access/index.ts';
import { createActivityService } from './modules/activity/index.ts';
import { createCycleService } from './modules/cycles/index.ts';
import { createIssueService } from './modules/issues/index.ts';
import { createPostgresIssueDependencies } from './modules/issues/postgres.ts';
import { createLabelService } from './modules/labels/index.ts';
import { createPlanningService } from './modules/planning/index.ts';
import { createSpecService } from './modules/specs/index.ts';
import type { Database } from './platform/database/client.ts';

export function createService(db: Database, options: { now?: () => Date } = {}): Service {
  const data = createUnitOfWork(db);
  return guardService({
    ...createAccessService(data),
    ...createIssueService(createPostgresIssueDependencies(db), options),
    ...createPlanningService(data),
    ...createLabelService(data),
    ...createSpecService(data, options),
    ...createCycleService(data, options),
    ...createActivityService(data),
  });
}
