// Worktree runtime isolation for the local preview chain.
//
// The primary checkout keeps the documented defaults (web 5178, api 18471,
// database roster_preview). Every secondary worktree gets a stable identity
// derived from its canonical path, a port slot, and its own *_preview
// database. Only resources whose names are derived from that identity are ever
// dropped. See .agents/skills/git-workflow/SKILL.md.
import { Pool } from 'npm:pg@8.23.1';

const MARKER = '# ROSTER_MANAGED_WORKTREE_ENV_V1';
const ENV_FILE = '.env.worktree';
const DEFAULT_WEB_PORT = 5178;
const DEFAULT_API_PORT = 18471;
const MAX_SLOT = 99;
const MANAGED_DB = /^roster_wt_[0-9a-f]{12}_preview$/;
const DEPENDENCY_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/web/package.json',
];

const checkoutRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const adminUrl = Deno.env.get('ROSTER_PREVIEW_ADMIN_URL') ??
  `postgresql://${Deno.env.get('USER') ?? 'postgres'}@127.0.0.1:55439/postgres`;
const runtimeRole = Deno.env.get('ROSTER_PREVIEW_RUNTIME_ROLE') ?? 'roster_preview_runtime';

type Managed = { managed: true; values: Map<string, string> } | { managed: false };

function fail(message: string): never {
  throw new Error(message);
}

function git(args: string[], cwd = checkoutRoot): string {
  const result = new Deno.Command('git', { args: ['-C', cwd, ...args], stderr: 'piped' })
    .outputSync();
  if (!result.success) fail(`git ${args[0]} failed: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}

function canonical(path: string): string {
  return Deno.realPathSync(path);
}

/** Registered worktrees that still exist on disk; the first one is primary. */
function worktrees(): string[] {
  return git(['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .filter((path) => {
      try {
        return Deno.statSync(path).isDirectory;
      } catch {
        return false;
      }
    })
    .map(canonical);
}

function primaryRoot(): string {
  const first = git(['worktree', 'list', '--porcelain']).split('\n')[0];
  if (!first?.startsWith('worktree ')) fail('cannot determine the primary checkout');
  return canonical(first.slice('worktree '.length));
}

async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

async function identity(root: string): Promise<string> {
  return (await sha256(canonical(root))).slice(0, 12);
}

function databaseName(id: string): string {
  const name = `roster_wt_${id}_preview`;
  if (!MANAGED_DB.test(name)) fail('derived database name is invalid');
  return name;
}

function readManaged(root: string): Managed | null {
  const path = `${root}/${ENV_FILE}`;
  let info: Deno.FileInfo;
  try {
    info = Deno.lstatSync(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
  if (!info.isFile) fail(`${path} must be a regular file`);
  const content = Deno.readTextFileSync(path);
  if (!content.startsWith(`${MARKER}\n`)) return { managed: false };
  const values = new Map<string, string>();
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return { managed: true, values };
}

/** Reads the managed file and proves it belongs to this exact worktree path. */
async function ownedEnvironment(root: string): Promise<Map<string, string> | null> {
  const environment = readManaged(root);
  if (!environment) return null;
  if (!environment.managed) fail(`${ENV_FILE} exists but is not managed; refusing to touch it`);
  const id = await identity(root);
  if (environment.values.get('ROSTER_WORKTREE_ID') !== id) {
    fail(`${ENV_FILE} belongs to a different worktree path (moved or copied); refusing`);
  }
  if (environment.values.get('ROSTER_PREVIEW_DATABASE') !== databaseName(id)) {
    fail(`${ENV_FILE} database does not match the worktree identity; refusing`);
  }
  return environment.values;
}

function occupiedSlots(current: string): Set<number> {
  const slots = new Set<number>();
  for (const path of worktrees()) {
    if (path === current) continue;
    const environment = readManaged(path);
    if (!environment?.managed) continue;
    const slot = environment.values.get('ROSTER_WORKTREE_SLOT') ?? '';
    if (/^\d{1,2}$/.test(slot)) slots.add(Number(slot));
  }
  return slots;
}

function chooseSlot(id: string, occupied: Set<number>): number {
  const start = Number.parseInt(id.slice(0, 8), 16) % MAX_SLOT;
  for (let offset = 0; offset < MAX_SLOT; offset += 1) {
    const slot = ((start + offset) % MAX_SLOT) + 1;
    if (!occupied.has(slot)) return slot;
  }
  fail('no worktree port slot is available');
}

function runtimeUrl(database: string): string {
  const url = new URL(adminUrl);
  url.username = runtimeRole;
  url.password = '';
  url.pathname = `/${database}`;
  return url.toString();
}

function adminUrlFor(database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function assertLoopback(): void {
  const host = new URL(adminUrl).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    fail('ROSTER_PREVIEW_ADMIN_URL must point at a loopback Postgres');
  }
}

async function withAdmin<T>(action: (pool: Pool) => Promise<T>): Promise<T> {
  assertLoopback();
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    return await action(pool);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`preview Postgres at ${new URL(adminUrl).host}: ${message}`);
  } finally {
    await pool.end();
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) fail(`unsafe identifier: ${name}`);
  return `"${name}"`;
}

async function runMigrations(database: string): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--allow-env',
      '--allow-net',
      '--allow-read',
      `${checkoutRoot}/scripts/migrate.ts`,
    ],
    env: { DATABASE_URL: adminUrlFor(database) },
    stdout: 'inherit',
    stderr: 'inherit',
  }).output();
  if (!result.success) fail(`migrations failed for ${database}`);
}

async function dependencyStamp(root: string): Promise<string> {
  const parts: string[] = [];
  for (const relative of DEPENDENCY_FILES) {
    try {
      parts.push(relative, await sha256(Deno.readFileSync(`${root}/${relative}`)));
    } catch {
      parts.push(relative, '<missing>');
    }
  }
  return await sha256(parts.join('\n'));
}

async function installDependencies(root: string, ifNeeded: boolean): Promise<void> {
  const stampPath = `${root}/node_modules/.roster-dependencies.sha256`;
  const stamp = await dependencyStamp(root);
  if (ifNeeded) {
    try {
      if (Deno.readTextFileSync(stampPath).trim() === stamp) return;
    } catch {
      // Missing stamp or node_modules: install below.
    }
  }
  const result = await new Deno.Command(Deno.env.get('ROSTER_NODE') ?? 'node', {
    args: [`${root}/scripts/toolchain.mjs`, 'setup'],
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  }).output();
  if (!result.success) fail('local toolchain setup failed');
  Deno.writeTextFileSync(stampPath, `${stamp}\n`);
}

async function setup(root: string, ifNeeded: boolean): Promise<void> {
  root = canonical(root);
  if (root !== primaryRoot()) {
    const id = await identity(root);
    const database = databaseName(id);
    const existing = await ownedEnvironment(root);
    const kept = Number(existing?.get('ROSTER_WORKTREE_SLOT'));
    const occupied = occupiedSlots(root);
    const slot = Number.isInteger(kept) && kept >= 1 && kept <= MAX_SLOT && !occupied.has(kept)
      ? kept
      : chooseSlot(id, occupied);
    const values: [string, string][] = [
      ['ROSTER_WORKTREE_ID', id],
      ['ROSTER_WORKTREE_PATH', root],
      ['ROSTER_WORKTREE_SLOT', String(slot)],
      ['ROSTER_PREVIEW_DATABASE', database],
      ['DATABASE_URL', runtimeUrl(database)],
      ['PORT', String(DEFAULT_API_PORT + slot)],
      ['PREVIEW_FRONTEND_PORT', String(DEFAULT_WEB_PORT + slot)],
      ['VITE_LOCAL_PREVIEW', 'true'],
      ['VITE_PREVIEW_API_PORT', String(DEFAULT_API_PORT + slot)],
    ];
    const content = [
      MARKER,
      '# Generated by scripts/worktree-runtime.ts; do not edit. Rerun `node scripts/toolchain.mjs deno task worktree:setup`.',
      ...values.map(([key, value]) => `${key}=${value}`),
      '',
    ].join('\n');
    await withAdmin(async (pool) => {
      const found = await pool.query('select 1 from pg_database where datname = $1', [database]);
      if (!found.rows.length) await pool.query(`create database ${quoteIdent(database)}`);
      await pool.query(
        `grant connect on database ${quoteIdent(database)} to ${quoteIdent(runtimeRole)}`,
      );
    });
    await runMigrations(database);
    Deno.writeTextFileSync(`${root}/${ENV_FILE}`, content, { mode: 0o600 });
    console.log(
      `worktree ${id}: web http://127.0.0.1:${DEFAULT_WEB_PORT + slot}/roster, api 127.0.0.1:${
        DEFAULT_API_PORT + slot
      }, database ${database}`,
    );
  }
  await installDependencies(root, ifNeeded);
}

async function cleanup(path: string, fromHook = false): Promise<void> {
  let root: string;
  try {
    root = canonical(path);
  } catch {
    if (fromHook) return; // Already gone; `worktree:gc` collects leftovers.
    fail(`worktree path does not exist: ${path}`);
  }
  if (root === primaryRoot()) {
    if (fromHook) return;
    fail('the primary checkout keeps its preview database; nothing to clean');
  }
  const values = await ownedEnvironment(root);
  if (!values) {
    console.log('no managed runtime in this worktree; nothing to clean');
    return;
  }
  if (!fromHook && git(['status', '--porcelain'], root)) {
    fail('worktree has uncommitted changes; commit, push or discard them before cleanup');
  }
  const database = databaseName(await identity(root));
  await withAdmin(async (pool) => {
    await pool.query(`drop database if exists ${quoteIdent(database)} with (force)`);
  });
  Deno.removeSync(`${root}/${ENV_FILE}`);
  console.log(`dropped ${database}; now run: git worktree remove ${root}`);
}

async function cleanupHook(): Promise<void> {
  const input = await new Response(Deno.stdin.readable).text();
  if (input.length > 1024 * 1024) fail('hook payload is too large');
  const payload = JSON.parse(input || '{}');
  if (typeof payload.worktree_path !== 'string' || !payload.worktree_path) return;
  await cleanup(payload.worktree_path, true);
}

async function gc(apply: boolean): Promise<void> {
  const paths = worktrees();
  const primary = primaryRoot();
  const active = new Set<string>();
  for (const path of paths) if (path !== primary) active.add(databaseName(await identity(path)));
  await withAdmin(async (pool) => {
    const rows = (await pool.query(
      "select datname from pg_database where datname like 'roster\\_%\\_preview' order by datname",
    )).rows as { datname: string }[];
    const orphans = rows.map((row) => row.datname).filter((name) =>
      MANAGED_DB.test(name) && !active.has(name)
    );
    const unmanaged = rows.map((row) => row.datname).filter((name) =>
      !MANAGED_DB.test(name) && name !== 'roster_preview'
    );
    for (const name of orphans) {
      if (apply) await pool.query(`drop database ${quoteIdent(name)} with (force)`);
      console.log(`${apply ? 'dropped' : 'would drop'} orphan ${name}`);
    }
    for (const name of unmanaged) console.log(`left unmanaged ${name} untouched`);
    if (!orphans.length) console.log('no orphan worktree databases');
    else if (!apply) console.log('dry run; rerun with --apply to drop');
  });
}

/** Launches one half of the preview chain with this worktree's configuration. */
async function preview(part: string): Promise<void> {
  const root = canonical(checkoutRoot);
  const values = root === primaryRoot() ? null : await ownedEnvironment(root);
  if (root !== primaryRoot() && !values) {
    fail('run `node scripts/toolchain.mjs deno task worktree:setup` first');
  }
  const env: Record<string, string> = values ? Object.fromEntries(values) : {
    DATABASE_URL: Deno.env.get('DATABASE_URL') ?? runtimeUrl('roster_preview'),
    PORT: String(DEFAULT_API_PORT),
    PREVIEW_FRONTEND_PORT: String(DEFAULT_WEB_PORT),
    VITE_LOCAL_PREVIEW: 'true',
    VITE_PREVIEW_API_PORT: String(DEFAULT_API_PORT),
  };
  const command = part === 'api'
    ? new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-env', '--allow-net', 'apps/server/preview.ts'],
      cwd: root,
      env: {
        DATABASE_URL: env.DATABASE_URL,
        PORT: env.PORT,
        PREVIEW_FRONTEND_PORT: env.PREVIEW_FRONTEND_PORT,
      },
    })
    : part === 'web'
    ? new Deno.Command(Deno.env.get('ROSTER_NODE') ?? 'node', {
      args: [
        `${root}/scripts/toolchain.mjs`,
        '--filter',
        '@roster/web',
        'dev',
        '--port',
        env.PREVIEW_FRONTEND_PORT,
        '--strictPort',
      ],
      cwd: root,
      env: { VITE_LOCAL_PREVIEW: 'true', VITE_PREVIEW_API_PORT: env.VITE_PREVIEW_API_PORT },
    })
    : fail('usage: preview api|web');
  const status = await command.spawn().status;
  Deno.exit(status.code);
}

const [command = 'setup', ...rest] = Deno.args;
try {
  switch (command) {
    case 'setup':
      await setup(
        rest.find((arg) => !arg.startsWith('--')) ?? checkoutRoot,
        rest.includes('--if-needed'),
      );
      break;
    case 'cleanup':
      await cleanup(rest[0] ?? checkoutRoot);
      break;
    case 'cleanup-hook':
      await cleanupHook();
      break;
    case 'gc':
      await gc(rest.includes('--apply'));
      break;
    case 'preview':
      await preview(rest[0] ?? '');
      break;
    default:
      fail(
        'usage: worktree-runtime.ts setup [--if-needed]|cleanup [path]|cleanup-hook|gc [--apply]|preview api|web',
      );
  }
} catch (error) {
  console.error(`worktree-runtime: ${error instanceof Error ? error.message : error}`);
  Deno.exit(1);
}
