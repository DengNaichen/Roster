import type { RequestContext } from '../../../contracts/mod.ts';
import { checkIssueCriterionSchema } from '../../../contracts/issue-document.ts';
import * as schemas from '../../../contracts/schemas.ts';
import { identity } from '../modules/access/index.ts';
import { describeIssues, fail } from '../platform/errors/validation.ts';
import type { Service } from './mod.ts';
export function guardService(service: Service): Service {
  const validators: Record<
    string,
    {
      safeParse: (
        value: unknown,
      ) => {
        success: boolean;
        data?: unknown;
        error?: { issues: { path: PropertyKey[]; message: string }[] };
      };
    }
  > = {
    createWorkspace: schemas.createWorkspaceSchema,
    updateWorkspace: schemas.updateWorkspaceSchema,
    updateMember: schemas.updateMemberSchema,
    joinWorkspace: schemas.joinWorkspaceSchema,
    createTeam: schemas.createTeamSchema,
    updateTeam: schemas.updateTeamSchema,
    changeTeamMember: schemas.changeTeamMemberSchema,
    joinTeam: schemas.joinTeamSchema,
    listIssues: schemas.listIssuesSchema,
    createIssue: schemas.createIssueSchema,
    updateIssue: schemas.updateIssueSchema,
    checkIssueCriterion: checkIssueCriterionSchema,
  };
  const inputIndex: Record<string, number> = {
    createWorkspace: 1,
    joinWorkspace: 1,
    updateTeam: 3,
    changeTeamMember: 3,
    joinTeam: 3,
    updateIssue: 3,
    checkIssueCriterion: 3,
  };
  return new Proxy(service, {
    get(target, key: keyof Service) {
      const method = target[key];
      if (typeof method !== 'function') return method;
      return async (...args: unknown[]) => {
        identity(args[0] as RequestContext);
        const validator = validators[key];
        if (validator) {
          const index = inputIndex[key] ?? 2;
          const result = validator.safeParse(args[index] ?? {});
          if (!result.success) {
            fail('invalid_input', 'Invalid input: ' + describeIssues(result.error!.issues));
          }
          args[index] = result.data;
        }
        try {
          return await (method as (...values: unknown[]) => unknown)(...args);
        } catch (error) {
          let cause: unknown = error;
          for (let i = 0; i < 4 && cause; i++) {
            const e = cause as { code?: string; cause?: unknown };
            if (e.code === '23505') fail('conflict', 'Resource already exists');
            if (
              ['23503', '23514', '22003', '22P02'].includes(e.code ?? '')
            ) fail('invalid_input', 'Invalid reference or field value');
            cause = e.cause;
          }
          throw error;
        }
      };
    },
  });
}
