import { AppError } from '../../../contracts/mod.ts';
import { createAccessService } from '../modules/access/index.ts';
import { createSpecService } from '../modules/specs/index.ts';
import { createLabelService } from '../modules/labels/index.ts';
import type { Session, UnitOfWork } from './session.ts';

const actor = { identity: { subject: 'owner', name: 'Owner', email: '' } };
type PartialSession = { [K in keyof Session]?: Partial<Session[K]> };
/** Unexpected reads or writes fail immediately; no database/driver is needed for these use cases. */
function fixture(overrides: PartialSession) {
  let transactions = 0;
  const keys: (keyof Session)[] = [
    'access',
    'activity',
    'audit',
    'cycles',
    'github',
    'issues',
    'labels',
    'planning',
    'specs',
  ];
  const repositories = {
    ...overrides,
    access: {
      findWorkspace: async () => ({ id: 'w', slug: 'workspace' }),
      activeMembership: async () => [{ role: 'admin' }],
      ...overrides.access,
    },
  };
  const session = Object.fromEntries(keys.map((key) => [
    key,
    new Proxy(repositories[key] ?? {}, {
      get(target, method) {
        if (method in target) return Reflect.get(target, method);
        return () => {
          throw new Error(`Unexpected repository operation ${key}.${String(method)}`);
        };
      },
    }),
  ])) as unknown as Session;
  const data: UnitOfWork = {
    ...session,
    transaction: async (run) => {
      transactions++;
      return await run(session);
    },
  };
  return { data, transactions: () => transactions };
}
async function rejects(run: () => Promise<unknown>, code: string) {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError && error.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
Deno.test('Access use case rejects removal of the last administrator before any write', async () => {
  const f = fixture({
    access: {
      findMember: async () => ({ role: 'admin', status: 'active' }),
      countAdministrators: async () => ({ n: 1 }),
    },
  });
  await rejects(
    () =>
      createAccessService(f.data).updateMember(actor, 'workspace', {
        subject: 'owner',
        role: 'member',
        status: 'active',
      }),
    'conflict',
  );
  if (f.transactions() !== 1) throw new Error('Membership check must run in a transaction');
});
Deno.test('Spec use case rejects stale revision before loading history or changing records', async () => {
  const f = fixture({ specs: { findSpec: async () => ({ id: 1, current_revision: 2 }) } });
  await rejects(() =>
    createSpecService(f.data).updateSpec(actor, 'workspace', {
      identifier: 'SPEC-1',
      base_revision: 1,
      content: {
        title: 'Example',
        status: 'draft',
        stories: [],
        edge_cases: [],
        requirements: [],
        entities: [],
        success_criteria: [],
        clarifications: [],
      },
    }), 'conflict');
  if (f.transactions() !== 1) throw new Error('Version check must run in a transaction');
});
Deno.test('Label merge rejects hidden task associations before deleting either label', async () => {
  const f = fixture({
    labels: {
      findLabel: async ({ id }) => [{ id, group_id: null, archived: false }],
      hasHiddenIssues: async () => [{ exists: true }],
    },
  });
  await rejects(
    () =>
      createLabelService(f.data).mergeLabels(actor, 'workspace', { source_id: 1, target_id: 2 }),
    'forbidden',
  );
  if (f.transactions() !== 1) throw new Error('Visibility and merge must use one transaction');
});
