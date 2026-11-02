import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { changedFiles, handle, repository, runCheck, stateKey } from './quality-core.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'roster hooks ')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(root, 'packages'));
  fs.writeFileSync(path.join(root, 'packages/a.ts'), 'export const a = 1;\n');
  git('add', 'packages/a.ts');
  git('commit', '-qm', 'Initial');
  const event = (hook_event_name, extra = {}) => ({
    cwd: root,
    session_id: 'session/a',
    turn_id: 'turn/a',
    hook_event_name,
    ...extra,
  });
  const edit = () => fs.writeFileSync(path.join(root, 'packages/a.ts'), 'export const a = 2;\n');
  return { root, git, event, edit };
}
const pass = async () => ({ ok: true, output: '' });
const fail = async () => ({ ok: false, output: 'fixture diagnostic' });

test('committed clean changes are checked and linked repair preserves baseline', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  f.edit();
  f.git('commit', '-qam', 'Change');
  assert.equal(f.git('status', '--porcelain'), '');
  const result = await handle(f.event('Stop'), fail);
  assert.equal(result.decision, 'block');
  await handle(f.event('UserPromptSubmit', { turn_id: 'repair', prompt: result.reason }));
  let calls = 0;
  const retry = await handle(f.event('Stop', { turn_id: 'repair' }), () => {
    calls++;
    return fail();
  });
  assert.equal(calls, 1);
  assert.equal(retry.decision, undefined);
  assert.match(retry.systemMessage, /Still unresolved/);
});

test('untracked, staged, renamed and deleted files are included', (t) => {
  const f = fixture(t), baseline = f.git('rev-parse', 'HEAD').trim();
  f.git('mv', 'packages/a.ts', 'packages/b.ts');
  fs.writeFileSync(path.join(f.root, 'packages/new.ts'), 'new');
  assert.deepEqual(changedFiles(f.root, baseline).sort(), [
    'packages/a.ts',
    'packages/b.ts',
    'packages/new.ts',
  ]);
  fs.unlinkSync(path.join(f.root, 'packages/b.ts'));
  assert.ok(changedFiles(f.root, baseline).includes('packages/a.ts'));
});

test('no changes or documentation-only changes skip tools', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  fs.writeFileSync(path.join(f.root, 'README.md'), 'docs');
  assert.deepEqual(
    await handle(f.event('Stop'), () => {
      throw new Error('must not run');
    }),
    {},
  );
});

test('two sessions sharing a worktree never receive automatic repair', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  const overlap = await handle(f.event('UserPromptSubmit', { session_id: 'session/b' }));
  assert.match(overlap.systemMessage, /shares this worktree/);
  f.edit();
  for (const session_id of ['session/a', 'session/b']) {
    const result = await handle(f.event('Stop', { session_id }), fail);
    assert.equal(result.decision, undefined);
    assert.match(result.systemMessage, /Shared worktree/);
  }
});

test('worktrees isolate state even with identical host ids', async (t) => {
  const f = fixture(t);
  const second = path.join(f.root, 'second checkout');
  f.git('worktree', 'add', '-qb', 'second', second);
  const other = (name) => f.event(name, { cwd: second });
  await handle(f.event('UserPromptSubmit'));
  assert.deepEqual(await handle(other('UserPromptSubmit')), {});
  f.edit();
  assert.equal((await handle(f.event('Stop'), fail)).decision, 'block');
  assert.deepEqual(await handle(other('Stop'), pass), {});
});

test('new user turn invalidates an older in-flight result', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  f.edit();
  let release, started;
  const ready = new Promise((r) => {
    started = r;
  });
  const pending = handle(f.event('Stop'), () =>
    new Promise((r) => {
      release = r;
      started();
    }));
  await ready;
  await handle(f.event('UserPromptSubmit', { turn_id: 'new-turn' }));
  release(await fail());
  const result = await pending;
  assert.equal(result.decision, undefined);
  assert.match(result.systemMessage, /stale/);
});

test('missing identifiers or baseline runs full checks without continuation', async (t) => {
  const f = fixture(t);
  for (const extra of [{ session_id: undefined }, { turn_id: undefined }, {}]) {
    let called = false;
    const result = await handle(f.event('Stop', extra), () => {
      called = true;
      return fail();
    });
    assert.ok(called);
    assert.equal(result.decision, undefined);
    assert.match(result.systemMessage, /read-only checks failed/);
  }
});

test('corrupted state degrades to full read-only check', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  const file = path.join(
    f.root,
    '.git/roster-quality',
    `${stateKey(f.root, 'session/a', 'turn/a')}.json`,
  );
  fs.writeFileSync(file, '{broken');
  let called = false;
  const result = await handle(f.event('Stop'), () => {
    called = true;
    return pass();
  });
  assert.ok(called);
  assert.equal(result.decision, undefined);
  assert.match(result.systemMessage, /State\/check error/);
});

test('duplicate Stop cannot start concurrent checks or a second repair', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  f.edit();
  let release, started;
  const ready = new Promise((r) => {
    started = r;
  });
  const pending = handle(f.event('Stop'), () =>
    new Promise((r) => {
      release = r;
      started();
    }));
  await ready;
  assert.match((await handle(f.event('Stop'), pass)).systemMessage, /concurrent Stop/);
  release(await fail());
  assert.equal((await pending).decision, 'block');
  assert.equal((await handle(f.event('Stop'), fail)).decision, undefined);
});

test('file writes during checks disable automatic repair', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  f.edit();
  const result = await handle(f.event('Stop'), () => {
    fs.writeFileSync(path.join(f.root, 'packages/a.ts'), 'another writer');
    return fail();
  });
  assert.equal(result.decision, undefined);
  assert.match(result.systemMessage, /file changes/);
});

test('interrupt and session cleanup cannot clear another session', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  await handle(f.event('UserPromptSubmit', { session_id: 'session/b' }));
  const b = path.join(
    f.root,
    '.git/roster-quality',
    `${stateKey(f.root, 'session/b', 'turn/a')}.json`,
  );
  const before = fs.readFileSync(b, 'utf8');
  await handle(f.event('Interrupt'));
  await handle(f.event('SessionEnd', { turn_id: undefined }));
  assert.equal(fs.readFileSync(b, 'utf8'), before);
  assert.equal((await handle(f.event('Stop'), fail)).decision, undefined);
});

test('canonical root and state names handle aliases and hostile ids', (t) => {
  const f = fixture(t), alias = `${f.root}-alias`;
  fs.symlinkSync(f.root, alias);
  t.after(() => fs.unlinkSync(alias));
  assert.equal(repository(alias), f.root);
  assert.match(stateKey(f.root, '../../session', 'turn\0x'), /^[a-f0-9]{64}$/);
  assert.notEqual(stateKey(f.root, 'a', 'bc'), stateKey(f.root, 'ab', 'c'));
});

test('real command runner reports missing tools, timeouts and bounded diagnostics', async (t) => {
  const f = fixture(t);
  assert.equal((await runCheck(f.root, 1000, ['roster-tool-that-does-not-exist'])).ok, false);
  assert.match(
    (await runCheck(f.root, 50, [process.execPath, '-e', 'setTimeout(()=>{},10000)'])).output,
    /timed out/,
  );
  const result = await runCheck(f.root, 2000, [
    process.execPath,
    '-e',
    'console.log("x".repeat(20000));process.exit(1)',
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.output.length <= 6000);
});

test('entrypoint emits only JSON and keeps worktree files read-only', async (t) => {
  const f = fixture(t), script = new URL('./quality.mjs', import.meta.url);
  const invoke = (event) =>
    JSON.parse(
      execFileSync(process.execPath, [script.pathname], {
        input: JSON.stringify(event),
        encoding: 'utf8',
      }),
    );
  assert.deepEqual(invoke(f.event('UserPromptSubmit')), {});
  assert.deepEqual(invoke(f.event('Stop')), {});
  assert.equal(f.git('status', '--porcelain'), '');
  assert.match(
    JSON.parse(
      execFileSync(process.execPath, [script.pathname], { input: 'broken', encoding: 'utf8' }),
    ).systemMessage,
    /incomplete/,
  );
});

test('unlinked host continuation checks clean commits without borrowing a baseline', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  f.edit();
  f.git('commit', '-qam', 'Commit before Stop');
  assert.equal((await handle(f.event('Stop'), fail)).decision, 'block');
  await handle(
    f.event('UserPromptSubmit', {
      turn_id: 'unlinked-repair',
      prompt: 'Host changed the continuation text',
    }),
  );
  let called = false;
  const result = await handle(
    f.event('Stop', { turn_id: 'unlinked-repair', stop_hook_active: true }),
    () => {
      called = true;
      return fail();
    },
  );
  assert.ok(called);
  assert.equal(result.decision, undefined);
  assert.match(result.systemMessage, /Unverified continuation/);
});

test('a continuation reason cannot be transferred to another session', async (t) => {
  const f = fixture(t);
  await handle(f.event('UserPromptSubmit'));
  f.edit();
  const first = await handle(f.event('Stop'), fail);
  await handle(f.event('UserPromptSubmit', { session_id: 'session/b', prompt: first.reason }));
  const file = path.join(
    f.root,
    '.git/roster-quality',
    `${stateKey(f.root, 'session/b', 'turn/a')}.json`,
  );
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.retries, 0);
  assert.equal(state.origin, stateKey(f.root, 'session/b', 'turn/a'));
  assert.equal(
    (await handle(f.event('Stop', { session_id: 'session/b' }), fail)).decision,
    undefined,
  );
});
