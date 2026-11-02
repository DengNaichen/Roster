import type { Service } from './application/mod.ts';

import { guardService } from './application/guard.ts';
import { createAccessService } from './modules/access/index.ts';
import { createActivityService } from './modules/activity/index.ts';
import { createCycleService } from './modules/cycles/index.ts';
import { createIssueService, createPostgresIssueDependencies } from './modules/issues/index.ts';
import { createLabelService } from './modules/labels/index.ts';
import { createPlanningService } from './modules/planning/index.ts';
import { createSpecService } from './modules/specs/index.ts';
import type { Database } from './platform/database/client.ts';

export function createService(db: Database, options: { now?: () => Date } = {}): Service {
  return guardService({
    ...createAccessService(db),
    ...createIssueService(createPostgresIssueDependencies(db), options),
    ...createPlanningService(db),
    ...createLabelService(db),
    ...createSpecService(db, options),
    ...createCycleService(db, options),
    ...createActivityService(db),
  });
}
